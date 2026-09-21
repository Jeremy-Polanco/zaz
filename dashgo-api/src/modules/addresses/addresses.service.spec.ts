/**
 * Unit specs for AddressesService.
 *
 * Repository<UserAddress> and DataSource are mocked.
 * DataSource.transaction callback receives a mock manager whose getRepository()
 * returns the same repo mock.
 */

import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { AddressesService } from './addresses.service';
import { UserAddress } from '../../entities/user-address.entity';
import { User } from '../../entities/user.entity';
import { DeliveryZone } from '../../entities/delivery-zone.entity';
import { CreateAddressDto } from './dto/create-address.dto';
import { UpdateAddressDto } from './dto/update-address.dto';
import { TaxJurisdictionService } from './tax-jurisdiction.service';
import { GeocodingService } from '../geocoding/geocoding.service';
import type { GeocodedPlace } from '../geocoding/nominatim';
import { TAX_RATE } from '../../common/tax';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRepoMock(): jest.Mocked<Repository<UserAddress>> {
  return {
    find: jest.fn(),
    findOne: jest.fn(),
    count: jest.fn(),
    create: jest.fn((dto: Partial<UserAddress>) => dto as UserAddress),
    save: jest.fn(),
    delete: jest.fn(),
    createQueryBuilder: jest.fn(),
  } as unknown as jest.Mocked<Repository<UserAddress>>;
}

function makeUserRepoMock(): jest.Mocked<Repository<User>> {
  return {
    update: jest.fn(),
    findOne: jest.fn(),
  } as unknown as jest.Mocked<Repository<User>>;
}

// Las zonas se leen enteras y se resuelven en memoria: son cuatro filas y el
// prefijo más largo no se puede pedir en SQL sin un LIKE por fila.
function makeZonesRepoMock(
  zones: Array<Partial<DeliveryZone>> = [],
): jest.Mocked<Repository<DeliveryZone>> {
  return {
    find: jest.fn().mockResolvedValue(zones),
  } as unknown as jest.Mocked<Repository<DeliveryZone>>;
}

/**
 * La tasa de impuesto de una dirección NO es una columna: se calcula al
 * responder, a partir de la zona. Por defecto el mock devuelve el fallback
 * histórico, que es lo que corresponde a una dirección sin zona.
 */
function makeZoneRatesMock(
  resolved: {
    zoneId: string | null;
    jurisdiction: 'NJ' | 'NYC' | null;
    taxRate: number;
  } = {
    zoneId: null,
    jurisdiction: null,
    taxRate: TAX_RATE,
  },
) {
  return {
    resolveTaxRate: jest.fn().mockResolvedValue(resolved),
    resolveTaxRates: jest
      .fn()
      .mockImplementation((queries: unknown[]) =>
        Promise.resolve(queries.map(() => resolved)),
      ),
  };
}

function makeGeocodingMock(place: GeocodedPlace | null = null) {
  return { reverse: jest.fn().mockResolvedValue(place) };
}

function makeDataSourceMock(
  repoMock: jest.Mocked<Repository<UserAddress>>,
): jest.Mocked<Pick<DataSource, 'transaction'>> {
  return {
    transaction: jest.fn().mockImplementation(async (cb: (mgr: unknown) => Promise<unknown>) => {
      const mockManager = {
        getRepository: jest.fn().mockReturnValue(repoMock),
      };
      return cb(mockManager);
    }),
  } as unknown as jest.Mocked<Pick<DataSource, 'transaction'>>;
}

function fakeAddress(overrides: Partial<UserAddress> = {}): UserAddress {
  return {
    id: 'addr-1',
    userId: 'user-1',
    label: 'Casa',
    line1: 'Calle 1',
    line2: null,
    building: null,
    lat: 18.47,
    lng: -69.9,
    instructions: null,
    postalCode: null,
    houseNumber: null,
    city: null,
    state: null,
    county: null,
    geocodedAt: null,
    zoneId: null,
    zone: null,
    isDefault: false,
    createdAt: new Date('2024-01-01T00:00:00.000Z'),
    updatedAt: new Date('2024-01-01T00:00:00.000Z'),
    user: {} as never,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// AddressesService — list
// ---------------------------------------------------------------------------

describe('AddressesService — list', () => {
  let service: AddressesService;
  let repo: jest.Mocked<Repository<UserAddress>>;

  beforeEach(async () => {
    repo = makeRepoMock();
    const ds = makeDataSourceMock(repo);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AddressesService,
        { provide: getRepositoryToken(UserAddress), useValue: repo },
        { provide: getRepositoryToken(User), useValue: makeUserRepoMock() },
        { provide: getRepositoryToken(DeliveryZone), useValue: makeZonesRepoMock() },
        { provide: DataSource, useValue: ds },
        { provide: TaxJurisdictionService, useValue: makeZoneRatesMock() },
        { provide: GeocodingService, useValue: makeGeocodingMock() },
      ],
    }).compile();

    service = module.get<AddressesService>(AddressesService);
  });

  it('calls repo.find with correct where + order and returns results', async () => {
    const addrB = fakeAddress({ id: 'addr-b', label: 'B', isDefault: true, createdAt: new Date('2024-01-02') });
    const addrA = fakeAddress({ id: 'addr-a', label: 'A', isDefault: false, createdAt: new Date('2024-01-01') });
    const addrC = fakeAddress({ id: 'addr-c', label: 'C', isDefault: false, createdAt: new Date('2024-01-03') });
    repo.find.mockResolvedValue([addrB, addrA, addrC]);

    const result = await service.list('user-1');

    expect(repo.find).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      order: { isDefault: 'DESC', createdAt: 'ASC' },
    });
    // La respuesta ya no es la entidad cruda: lleva la tasa que le toca.
    expect(result).toEqual([
      { ...addrB, taxRate: TAX_RATE, taxJurisdiction: null },
      { ...addrA, taxRate: TAX_RATE, taxJurisdiction: null },
      { ...addrC, taxRate: TAX_RATE, taxJurisdiction: null },
    ]);
  });

  it('returns empty array when user has no addresses', async () => {
    repo.find.mockResolvedValue([]);
    const result = await service.list('user-1');
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// AddressesService — create (happy path + auto-default)
// ---------------------------------------------------------------------------

describe('AddressesService — create', () => {
  let service: AddressesService;
  let repo: jest.Mocked<Repository<UserAddress>>;

  beforeEach(async () => {
    repo = makeRepoMock();
    const ds = makeDataSourceMock(repo);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AddressesService,
        { provide: getRepositoryToken(UserAddress), useValue: repo },
        { provide: getRepositoryToken(User), useValue: makeUserRepoMock() },
        { provide: getRepositoryToken(DeliveryZone), useValue: makeZonesRepoMock() },
        { provide: DataSource, useValue: ds },
        { provide: TaxJurisdictionService, useValue: makeZoneRatesMock() },
        { provide: GeocodingService, useValue: makeGeocodingMock() },
      ],
    }).compile();

    service = module.get<AddressesService>(AddressesService);
  });

  it('creates with isDefault=false when user already has addresses (count=5)', async () => {
    repo.count.mockResolvedValue(5);
    const saved = fakeAddress({ isDefault: false });
    repo.save.mockResolvedValue(saved);

    const dto: CreateAddressDto = { label: 'Oficina', line1: 'Calle 5', lat: 18.47, lng: -69.9 };
    const result = await service.create('user-1', dto);

    expect(repo.count).toHaveBeenCalledWith({ where: { userId: 'user-1' } });
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1', isDefault: false }),
    );
    expect(repo.save).toHaveBeenCalled();
    expect(result).toEqual({ ...saved, taxRate: TAX_RATE, taxJurisdiction: null });
  });

  it('creates with isDefault=true when user has no addresses (count=0)', async () => {
    repo.count.mockResolvedValue(0);
    const saved = fakeAddress({ isDefault: true });
    repo.save.mockResolvedValue(saved);

    const dto: CreateAddressDto = { label: 'Casa', line1: 'Calle 1', lat: 18.47, lng: -69.9 };
    await service.create('user-1', dto);

    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1', isDefault: true }),
    );
  });

  it('throws BadRequestException with ADDRESS_CAP_EXCEEDED when count=10', async () => {
    repo.count.mockResolvedValue(10);

    const dto: CreateAddressDto = { label: 'Casa', line1: 'Calle 1', lat: 18.47, lng: -69.9 };
    await expect(service.create('user-1', dto)).rejects.toThrow(BadRequestException);

    // save must NOT be called
    expect(repo.save).not.toHaveBeenCalled();

    // verify error code
    try {
      await service.create('user-1', dto);
    } catch (e: unknown) {
      const err = e as BadRequestException;
      const response = err.getResponse() as Record<string, unknown>;
      expect(response.code).toBe('ADDRESS_CAP_EXCEEDED');
    }
  });

  it('throws BadRequestException when count exceeds 10 (e.g. 12)', async () => {
    repo.count.mockResolvedValue(12);

    const dto: CreateAddressDto = { label: 'Casa', line1: 'Calle 1', lat: 18.47, lng: -69.9 };
    await expect(service.create('user-1', dto)).rejects.toThrow(BadRequestException);
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('saves with count=9 (below cap)', async () => {
    repo.count.mockResolvedValue(9);
    repo.save.mockResolvedValue(fakeAddress());

    const dto: CreateAddressDto = { label: 'Casa', line1: 'Calle 1', lat: 18.47, lng: -69.9 };
    await service.create('user-1', dto);

    expect(repo.save).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// AddressesService — update
// ---------------------------------------------------------------------------

describe('AddressesService — update', () => {
  let service: AddressesService;
  let repo: jest.Mocked<Repository<UserAddress>>;

  beforeEach(async () => {
    repo = makeRepoMock();
    const ds = makeDataSourceMock(repo);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AddressesService,
        { provide: getRepositoryToken(UserAddress), useValue: repo },
        { provide: getRepositoryToken(User), useValue: makeUserRepoMock() },
        { provide: getRepositoryToken(DeliveryZone), useValue: makeZonesRepoMock() },
        { provide: DataSource, useValue: ds },
        { provide: TaxJurisdictionService, useValue: makeZoneRatesMock() },
        { provide: GeocodingService, useValue: makeGeocodingMock() },
      ],
    }).compile();

    service = module.get<AddressesService>(AddressesService);
  });

  it('applies whitelisted fields and saves for own address', async () => {
    const existing = fakeAddress({ id: 'addr-1', userId: 'user-1', label: 'Casa', isDefault: false });
    repo.findOne.mockResolvedValue(existing);
    const updated = { ...existing, label: 'Oficina', instructions: 'piso 3' };
    repo.save.mockResolvedValue(updated as UserAddress);

    const dto: UpdateAddressDto = { label: 'Oficina', instructions: 'piso 3' };
    const result = await service.update('user-1', 'addr-1', dto);

    expect(repo.findOne).toHaveBeenCalledWith({ where: { id: 'addr-1' } });
    expect(repo.save).toHaveBeenCalled();
    expect(result.label).toBe('Oficina');
    expect(result.instructions).toBe('piso 3');
  });

  it('never assigns isDefault even if dto somehow contains it', async () => {
    const existing = fakeAddress({ id: 'addr-1', userId: 'user-1', isDefault: false });
    repo.findOne.mockResolvedValue(existing);
    repo.save.mockImplementation(async (entity) => entity as UserAddress);

    // Force isDefault into the dto (simulating a leak)
    const dto = { label: 'X', isDefault: true } as UpdateAddressDto & { isDefault?: boolean };
    await service.update('user-1', 'addr-1', dto);

    const savedArg = repo.save.mock.calls[0][0] as UserAddress;
    // isDefault must remain false (not promoted by update)
    expect(savedArg.isDefault).toBe(false);
  });

  it('throws NotFoundException when address not found', async () => {
    repo.findOne.mockResolvedValue(null);

    const dto: UpdateAddressDto = { label: 'X' };
    await expect(service.update('user-1', 'addr-ghost', dto)).rejects.toThrow(NotFoundException);
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('throws NotFoundException when address belongs to another user', async () => {
    const other = fakeAddress({ id: 'addr-1', userId: 'user-OTHER' });
    repo.findOne.mockResolvedValue(other);

    const dto: UpdateAddressDto = { label: 'X' };
    await expect(service.update('user-1', 'addr-1', dto)).rejects.toThrow(NotFoundException);
    expect(repo.save).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// AddressesService — delete
// ---------------------------------------------------------------------------

describe('AddressesService — delete', () => {
  let service: AddressesService;
  let repo: jest.Mocked<Repository<UserAddress>>;
  let dsTransactionMock: jest.Mock;

  beforeEach(async () => {
    repo = makeRepoMock();

    // For delete tests, we need fine-grained control over the transaction mock
    // so that repo calls inside the TX can be sequenced.
    dsTransactionMock = jest.fn().mockImplementation(async (cb: (mgr: unknown) => Promise<unknown>) => {
      const mockManager = {
        getRepository: jest.fn().mockReturnValue(repo),
      };
      return cb(mockManager);
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AddressesService,
        { provide: getRepositoryToken(UserAddress), useValue: repo },
        { provide: getRepositoryToken(User), useValue: makeUserRepoMock() },
        { provide: getRepositoryToken(DeliveryZone), useValue: makeZonesRepoMock() },
        { provide: DataSource, useValue: { transaction: dsTransactionMock } },
        { provide: TaxJurisdictionService, useValue: makeZoneRatesMock() },
        { provide: GeocodingService, useValue: makeGeocodingMock() },
      ],
    }).compile();

    service = module.get<AddressesService>(AddressesService);
  });

  it('deletes non-default address without promotion', async () => {
    const addr = fakeAddress({ id: 'addr-1', userId: 'user-1', isDefault: false });
    repo.findOne.mockResolvedValueOnce(addr);

    await service.delete('user-1', 'addr-1');

    expect(repo.delete).toHaveBeenCalledWith('addr-1');
    // findOne should only have been called once (no promotion query)
    expect(repo.findOne).toHaveBeenCalledTimes(1);
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('throws NotFoundException when address not found', async () => {
    repo.findOne.mockResolvedValueOnce(null);

    await expect(service.delete('user-1', 'addr-ghost')).rejects.toThrow(NotFoundException);
    expect(repo.delete).not.toHaveBeenCalled();
  });

  it('throws NotFoundException when address belongs to another user', async () => {
    const other = fakeAddress({ id: 'addr-1', userId: 'user-OTHER', isDefault: false });
    repo.findOne.mockResolvedValueOnce(other);

    await expect(service.delete('user-1', 'addr-1')).rejects.toThrow(NotFoundException);
    expect(repo.delete).not.toHaveBeenCalled();
  });

  it('promotes most-recent remaining address when deleting default with siblings', async () => {
    // A is default (oldest), B and C exist; C is most recent
    const addrA = fakeAddress({ id: 'addr-a', userId: 'user-1', isDefault: true, createdAt: new Date('2024-01-01') });
    const addrC = fakeAddress({ id: 'addr-c', userId: 'user-1', isDefault: false, createdAt: new Date('2024-03-01') });

    // First findOne → loads the target (A); second findOne → loads most recent remaining (C)
    repo.findOne
      .mockResolvedValueOnce(addrA)
      .mockResolvedValueOnce(addrC);
    repo.save.mockResolvedValue({ ...addrC, isDefault: true } as UserAddress);

    await service.delete('user-1', 'addr-a');

    expect(repo.delete).toHaveBeenCalledWith('addr-a');
    // Second findOne fetches next candidate ordered by createdAt DESC
    expect(repo.findOne).toHaveBeenCalledTimes(2);
    expect(repo.save).toHaveBeenCalledWith(expect.objectContaining({ id: 'addr-c', isDefault: true }));
  });

  it('deletes last address with no promotion and no error', async () => {
    const addrA = fakeAddress({ id: 'addr-a', userId: 'user-1', isDefault: true });
    repo.findOne
      .mockResolvedValueOnce(addrA)
      .mockResolvedValueOnce(null); // no remaining addresses

    await service.delete('user-1', 'addr-a');

    expect(repo.delete).toHaveBeenCalledWith('addr-a');
    expect(repo.save).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// AddressesService — setDefault
// ---------------------------------------------------------------------------

describe('AddressesService — setDefault', () => {
  let service: AddressesService;
  let repo: jest.Mocked<Repository<UserAddress>>;
  let dsTransactionMock: jest.Mock;

  beforeEach(async () => {
    repo = makeRepoMock();

    dsTransactionMock = jest.fn().mockImplementation(async (cb: (mgr: unknown) => Promise<unknown>) => {
      const mockManager = {
        getRepository: jest.fn().mockReturnValue(repo),
      };
      return cb(mockManager);
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AddressesService,
        { provide: getRepositoryToken(UserAddress), useValue: repo },
        { provide: getRepositoryToken(User), useValue: makeUserRepoMock() },
        { provide: getRepositoryToken(DeliveryZone), useValue: makeZonesRepoMock() },
        { provide: DataSource, useValue: { transaction: dsTransactionMock } },
        { provide: TaxJurisdictionService, useValue: makeZoneRatesMock() },
        { provide: GeocodingService, useValue: makeGeocodingMock() },
      ],
    }).compile();

    service = module.get<AddressesService>(AddressesService);
  });

  it('clears others via query builder then sets target isDefault=true and saves', async () => {
    const target = fakeAddress({ id: 'addr-b', userId: 'user-1', isDefault: false });
    repo.findOne.mockResolvedValue(target);

    // Mock the query builder chain for the UPDATE
    const mockQb = {
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    repo.createQueryBuilder.mockReturnValue(mockQb as never);
    repo.save.mockResolvedValue({ ...target, isDefault: true } as UserAddress);

    const result = await service.setDefault('user-1', 'addr-b');

    expect(repo.findOne).toHaveBeenCalledWith({ where: { id: 'addr-b' } });
    expect(mockQb.update).toHaveBeenCalled();
    expect(mockQb.set).toHaveBeenCalledWith({ isDefault: false });
    expect(mockQb.where).toHaveBeenCalled();
    expect(mockQb.execute).toHaveBeenCalled();
    expect(repo.save).toHaveBeenCalledWith(expect.objectContaining({ isDefault: true }));
    expect(result.isDefault).toBe(true);
  });

  it('runs inside a transaction', async () => {
    const target = fakeAddress({ id: 'addr-b', userId: 'user-1' });
    repo.findOne.mockResolvedValue(target);

    const mockQb = {
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    repo.createQueryBuilder.mockReturnValue(mockQb as never);
    repo.save.mockResolvedValue({ ...target, isDefault: true } as UserAddress);

    await service.setDefault('user-1', 'addr-b');

    expect(dsTransactionMock).toHaveBeenCalledTimes(1);
  });

  it('throws NotFoundException when address not found', async () => {
    repo.findOne.mockResolvedValue(null);

    await expect(service.setDefault('user-1', 'addr-ghost')).rejects.toThrow(NotFoundException);
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('throws NotFoundException when address belongs to another user', async () => {
    const other = fakeAddress({ id: 'addr-1', userId: 'user-OTHER' });
    repo.findOne.mockResolvedValue(other);

    await expect(service.setDefault('user-1', 'addr-1')).rejects.toThrow(NotFoundException);
    expect(repo.save).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// AddressesService — listByUserId
// ---------------------------------------------------------------------------

describe('AddressesService — listByUserId', () => {
  let service: AddressesService;
  let repo: jest.Mocked<Repository<UserAddress>>;

  beforeEach(async () => {
    repo = makeRepoMock();
    const ds = makeDataSourceMock(repo);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AddressesService,
        { provide: getRepositoryToken(UserAddress), useValue: repo },
        { provide: getRepositoryToken(User), useValue: makeUserRepoMock() },
        { provide: getRepositoryToken(DeliveryZone), useValue: makeZonesRepoMock() },
        { provide: DataSource, useValue: ds },
        { provide: TaxJurisdictionService, useValue: makeZoneRatesMock() },
        { provide: GeocodingService, useValue: makeGeocodingMock() },
      ],
    }).compile();

    service = module.get<AddressesService>(AddressesService);
  });

  it('delegates to list() and returns addresses in same order', async () => {
    const addresses = [
      fakeAddress({ id: 'addr-1', isDefault: true }),
      fakeAddress({ id: 'addr-2', isDefault: false }),
    ];
    repo.find.mockResolvedValue(addresses);

    const result = await service.listByUserId('user-1');

    expect(repo.find).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      order: { isDefault: 'DESC', createdAt: 'ASC' },
    });
    expect(result).toEqual(addresses.map((a) => ({ ...a, taxRate: TAX_RATE, taxJurisdiction: null })));
  });

  it('returns empty array for user with no addresses', async () => {
    repo.find.mockResolvedValue([]);
    const result = await service.listByUserId('user-other');
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// AddressesService — setActiveLocation
// ---------------------------------------------------------------------------

describe('AddressesService — setActiveLocation', () => {
  let service: AddressesService;
  let repo: jest.Mocked<Repository<UserAddress>>;
  let userRepo: jest.Mocked<Repository<User>>;

  beforeEach(async () => {
    repo = makeRepoMock();
    userRepo = makeUserRepoMock();
    const ds = makeDataSourceMock(repo);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AddressesService,
        { provide: getRepositoryToken(UserAddress), useValue: repo },
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: getRepositoryToken(DeliveryZone), useValue: makeZonesRepoMock() },
        { provide: DataSource, useValue: ds },
        { provide: TaxJurisdictionService, useValue: makeZoneRatesMock() },
        { provide: GeocodingService, useValue: makeGeocodingMock() },
      ],
    }).compile();

    service = module.get<AddressesService>(AddressesService);
  });

  it('points users.active_location_id at the address and returns it', async () => {
    const target = fakeAddress({ id: 'addr-b', userId: 'user-1' });
    repo.findOne.mockResolvedValue(target);

    const result = await service.setActiveLocation('user-1', 'addr-b');

    expect(repo.findOne).toHaveBeenCalledWith({ where: { id: 'addr-b' } });
    expect(userRepo.update).toHaveBeenCalledWith('user-1', {
      activeLocationId: 'addr-b',
    });
    expect(result).toEqual({ ...target, taxRate: TAX_RATE, taxJurisdiction: null });
  });

  it('throws NotFoundException when address not found', async () => {
    repo.findOne.mockResolvedValue(null);

    await expect(
      service.setActiveLocation('user-1', 'addr-ghost'),
    ).rejects.toThrow(NotFoundException);
    expect(userRepo.update).not.toHaveBeenCalled();
  });

  it('throws NotFoundException when address belongs to another user', async () => {
    const other = fakeAddress({ id: 'addr-1', userId: 'user-OTHER' });
    repo.findOne.mockResolvedValue(other);

    await expect(
      service.setActiveLocation('user-1', 'addr-1'),
    ).rejects.toThrow(NotFoundException);
    expect(userRepo.update).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// AddressesService — código postal y zona de reparto
//
// El cliente escribe el ZIP; la zona NO se le pregunta, se resuelve y se guarda
// resuelta (agrupar clientes por zona es una pantalla que pagina: recalcular
// prefijos por fila la haría inútil).
// ---------------------------------------------------------------------------

describe('AddressesService — postalCode y zoneId', () => {
  let service: AddressesService;
  let repo: jest.Mocked<Repository<UserAddress>>;
  let zonesRepo: jest.Mocked<Repository<DeliveryZone>>;

  const ZONES: Array<Partial<DeliveryZone>> = [
    { id: 'zone-bronx', zipPrefixes: ['104'], isActive: true },
    { id: 'zone-brooklyn', zipPrefixes: ['112'], isActive: true },
    { id: 'zone-elizabeth', zipPrefixes: ['0720'], isActive: true },
  ];

  beforeEach(async () => {
    repo = makeRepoMock();
    zonesRepo = makeZonesRepoMock(ZONES);
    const ds = makeDataSourceMock(repo);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AddressesService,
        { provide: getRepositoryToken(UserAddress), useValue: repo },
        { provide: getRepositoryToken(User), useValue: makeUserRepoMock() },
        { provide: getRepositoryToken(DeliveryZone), useValue: zonesRepo },
        { provide: DataSource, useValue: ds },
        { provide: TaxJurisdictionService, useValue: makeZoneRatesMock() },
        { provide: GeocodingService, useValue: makeGeocodingMock() },
      ],
    }).compile();

    service = module.get<AddressesService>(AddressesService);
  });

  it('create guarda el ZIP y resuelve la zona contra las zonas ACTIVAS', async () => {
    repo.count.mockResolvedValue(0);
    repo.save.mockImplementation(async (e) => e as UserAddress);

    const dto: CreateAddressDto = {
      label: 'Casa',
      line1: '1000 Grand Concourse',
      lat: 40.82,
      lng: -73.92,
      postalCode: '10451',
    };
    await service.create('user-1', dto);

    expect(zonesRepo.find).toHaveBeenCalledWith({ where: { isActive: true } });
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ postalCode: '10451', zoneId: 'zone-bronx' }),
    );
  });

  it('create sin ZIP deja zona en null y NO va a buscar zonas', async () => {
    // La chincheta del admin guarda direcciones sin código postal: pedirle la
    // tabla de zonas a Postgres para no resolver nada es una consulta al pedo.
    repo.count.mockResolvedValue(0);
    repo.save.mockImplementation(async (e) => e as UserAddress);

    const dto: CreateAddressDto = {
      label: 'Casa',
      line1: 'Calle 1',
      lat: 40.82,
      lng: -73.92,
    };
    await service.create('user-1', dto);

    expect(zonesRepo.find).not.toHaveBeenCalled();
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ postalCode: null, zoneId: null }),
    );
  });

  it('create con un ZIP fuera de todas las zonas guarda el ZIP igual', async () => {
    // El dato del cliente no se tira porque el negocio todavía no reparte ahí:
    // mañana el dueño carga la zona y la dirección ya tiene con qué resolver.
    repo.count.mockResolvedValue(0);
    repo.save.mockImplementation(async (e) => e as UserAddress);

    await service.create('user-1', {
      label: 'Casa',
      line1: 'Beverly Hills',
      lat: 34.09,
      lng: -118.4,
      postalCode: '90210',
    });

    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ postalCode: '90210', zoneId: null }),
    );
  });

  it('update con un ZIP nuevo vuelve a resolver la zona', async () => {
    const existing = fakeAddress({
      userId: 'user-1',
      postalCode: '10451',
      zoneId: 'zone-bronx',
    });
    repo.findOne.mockResolvedValue(existing);
    repo.save.mockImplementation(async (e) => e as UserAddress);

    // El cliente se mudó del Bronx a Brooklyn.
    const result = await service.update('user-1', 'addr-1', {
      postalCode: '11201',
    } as UpdateAddressDto);

    expect(result.postalCode).toBe('11201');
    expect(result.zoneId).toBe('zone-brooklyn');
  });

  it('update SIN postalCode no toca ni el ZIP ni la zona', async () => {
    const existing = fakeAddress({
      userId: 'user-1',
      postalCode: '10451',
      zoneId: 'zone-bronx',
    });
    repo.findOne.mockResolvedValue(existing);
    repo.save.mockImplementation(async (e) => e as UserAddress);

    const result = await service.update('user-1', 'addr-1', {
      label: 'Oficina',
    } as UpdateAddressDto);

    expect(zonesRepo.find).not.toHaveBeenCalled();
    expect(result.postalCode).toBe('10451');
    expect(result.zoneId).toBe('zone-bronx');
  });

  it('update con el MISMO ZIP tampoco vuelve a consultar zonas', async () => {
    // Guardar el formulario entero sin haber tocado el código postal es el caso
    // normal: no tiene por qué pegarle a la tabla de zonas.
    const existing = fakeAddress({
      userId: 'user-1',
      postalCode: '10451',
      zoneId: 'zone-bronx',
    });
    repo.findOne.mockResolvedValue(existing);
    repo.save.mockImplementation(async (e) => e as UserAddress);

    const result = await service.update('user-1', 'addr-1', {
      label: 'Casa',
      postalCode: '10451',
    } as UpdateAddressDto);

    expect(zonesRepo.find).not.toHaveBeenCalled();
    expect(result.zoneId).toBe('zone-bronx');
  });

  it('update que BORRA el ZIP (null) borra también la zona', async () => {
    const existing = fakeAddress({
      userId: 'user-1',
      postalCode: '10451',
      zoneId: 'zone-bronx',
    });
    repo.findOne.mockResolvedValue(existing);
    repo.save.mockImplementation(async (e) => e as UserAddress);

    const result = await service.update('user-1', 'addr-1', {
      postalCode: null,
    } as unknown as UpdateAddressDto);

    expect(result.postalCode).toBeNull();
    expect(result.zoneId).toBeNull();
  });

  it('una zona APAGADA no clasifica — la dirección queda sin zona', async () => {
    zonesRepo.find.mockResolvedValue([]); // el where isActive:true no la trae
    repo.count.mockResolvedValue(0);
    repo.save.mockImplementation(async (e) => e as UserAddress);

    await service.create('user-1', {
      label: 'Casa',
      line1: 'Calle 1',
      lat: 40.82,
      lng: -73.92,
      postalCode: '10451',
    });

    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ postalCode: '10451', zoneId: null }),
    );
  });
});

// ---------------------------------------------------------------------------
// AddressesService — taxRate en la respuesta
//
// Por qué NO es columna: la tasa la fija la zona, y la zona la edita el admin.
// Guardarla copiada en cada dirección sería tener que rebackfillear la libreta
// entera cada vez que New Jersey cambia un decimal. Se calcula al responder.
// ---------------------------------------------------------------------------

describe('AddressesService — taxRate en la respuesta', () => {
  const NJ_RATE = 0.06625;
  let service: AddressesService;
  let repo: jest.Mocked<Repository<UserAddress>>;
  let zoneRates: ReturnType<typeof makeZoneRatesMock>;

  const build = async (resolved?: {
    zoneId: string | null;
    jurisdiction: 'NJ' | 'NYC' | null;
    taxRate: number;
  }) => {
    repo = makeRepoMock();
    zoneRates = makeZoneRatesMock(resolved);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AddressesService,
        { provide: getRepositoryToken(UserAddress), useValue: repo },
        { provide: getRepositoryToken(User), useValue: makeUserRepoMock() },
        {
          provide: getRepositoryToken(DeliveryZone),
          useValue: makeZonesRepoMock(),
        },
        { provide: DataSource, useValue: makeDataSourceMock(repo) },
        { provide: TaxJurisdictionService, useValue: zoneRates },
        { provide: GeocodingService, useValue: makeGeocodingMock() },
      ],
    }).compile();
    service = module.get<AddressesService>(AddressesService);
  };

  it('una dirección con zona de New Jersey responde 6.625%', async () => {
    await build({ zoneId: 'zone-nj', jurisdiction: 'NJ', taxRate: NJ_RATE });
    const addr = fakeAddress({ postalCode: '07201', zoneId: 'zone-nj' });
    repo.count.mockResolvedValue(0);
    repo.save.mockResolvedValue(addr);

    const result = await service.create('user-1', {
      label: 'Casa',
      line1: 'Calle 1',
      lat: 40.66,
      lng: -74.21,
      postalCode: '07201',
    } as CreateAddressDto);

    expect(result.taxRate).toBe(NJ_RATE);
  });

  it('una dirección sin zona responde el fallback histórico, nunca 0', async () => {
    await build();
    const addr = fakeAddress({ postalCode: null, zoneId: null });
    repo.count.mockResolvedValue(0);
    repo.save.mockResolvedValue(addr);

    const result = await service.create('user-1', {
      label: 'Casa',
      line1: 'Calle 1',
      lat: 18.47,
      lng: -69.9,
    } as CreateAddressDto);

    expect(result.taxRate).toBe(TAX_RATE);
  });

  it('pregunta por la zona YA resuelta de la dirección, no por el ZIP', async () => {
    // La libreta guarda `zone_id`: es la respuesta exacta y no depende de
    // volver a parsear el prefijo.
    await build({ zoneId: 'zone-nj', jurisdiction: 'NJ', taxRate: NJ_RATE });
    repo.find.mockResolvedValue([
      fakeAddress({ id: 'a1', zoneId: 'zone-nj', postalCode: '07201' }),
    ]);

    await service.list('user-1');

    expect(zoneRates.resolveTaxRates).toHaveBeenCalledWith([
      {
        zoneId: 'zone-nj',
        postalCode: '07201',
        state: null,
        city: null,
        county: null,
      },
    ]);
  });

  it('el listado resuelve todas las direcciones de una sola vez', async () => {
    // Diez direcciones no pueden ser diez consultas a la tabla de zonas.
    await build();
    repo.find.mockResolvedValue([
      fakeAddress({ id: 'a1' }),
      fakeAddress({ id: 'a2' }),
      fakeAddress({ id: 'a3' }),
    ]);

    const result = await service.list('user-1');

    expect(zoneRates.resolveTaxRates).toHaveBeenCalledTimes(1);
    expect(result.map((a) => a.taxRate)).toEqual([
      TAX_RATE,
      TAX_RATE,
      TAX_RATE,
    ]);
  });

  it('setDefault también devuelve la tasa — es la misma respuesta para el cliente', async () => {
    await build({ zoneId: 'zone-nj', jurisdiction: 'NJ', taxRate: NJ_RATE });
    const target = fakeAddress({ id: 'addr-b', zoneId: 'zone-nj' });
    repo.findOne.mockResolvedValue(target);
    repo.createQueryBuilder.mockReturnValue({
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({}),
    } as never);
    repo.save.mockImplementation((a) => Promise.resolve(a as UserAddress));

    const result = await service.setDefault('user-1', 'addr-b');

    expect(result.taxRate).toBe(NJ_RATE);
  });
});

// ---------------------------------------------------------------------------
// AddressesService — la dirección se completa sola desde la chincheta
//
// El cliente pone un punto en el mapa. Ciudad, estado y condado NO se le
// preguntan: se derivan de ese punto en el servidor, porque el estado decide la
// tasa de impuesto y un dato que manda el cliente es un dato que el cliente
// elige.
// ---------------------------------------------------------------------------

const NJ_RATE = 0.06625;

const ELIZABETH: GeocodedPlace = {
  houseNumber: '1101',
  road: 'Elizabeth Avenue',
  city: 'Elizabeth',
  county: 'Union County',
  state: 'NJ',
  postalCode: '07201',
  countryCode: 'us',
};

describe('AddressesService — relleno geocodificado', () => {
  let service: AddressesService;
  let repo: jest.Mocked<Repository<UserAddress>>;
  let geocoding: ReturnType<typeof makeGeocodingMock>;
  let zonesRepo: jest.Mocked<Repository<DeliveryZone>>;

  const build = async (place: GeocodedPlace | null = ELIZABETH) => {
    repo = makeRepoMock();
    geocoding = makeGeocodingMock(place);
    zonesRepo = makeZonesRepoMock([
      { id: 'zone-nj', zipPrefixes: ['0720'], isActive: true } as DeliveryZone,
    ]);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AddressesService,
        { provide: getRepositoryToken(UserAddress), useValue: repo },
        { provide: getRepositoryToken(User), useValue: makeUserRepoMock() },
        { provide: getRepositoryToken(DeliveryZone), useValue: zonesRepo },
        { provide: DataSource, useValue: makeDataSourceMock(repo) },
        {
          provide: TaxJurisdictionService,
          useValue: makeZoneRatesMock({
            zoneId: 'zone-nj',
            jurisdiction: 'NJ',
            taxRate: NJ_RATE,
          }),
        },
        { provide: GeocodingService, useValue: geocoding },
      ],
    }).compile();
    service = module.get<AddressesService>(AddressesService);
    repo.count.mockResolvedValue(0);
    repo.save.mockImplementation((a) => Promise.resolve(a as UserAddress));
  };

  const dto = (over: Partial<CreateAddressDto> = {}): CreateAddressDto =>
    ({ label: 'Casa', line1: '1101 Elizabeth Ave', lat: 40.6639, lng: -74.2107, ...over }) as CreateAddressDto;

  describe('create', () => {
    it('geocodifica la chincheta y guarda ciudad, estado y condado', async () => {
      await build();

      await service.create('user-1', dto());

      expect(geocoding.reverse).toHaveBeenCalledWith(40.6639, -74.2107);
      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          city: 'Elizabeth',
          state: 'NJ',
          county: 'Union County',
        }),
      );
    });

    it('el ZIP que escribió el cliente MANDA sobre el geocodificado', async () => {
      // El cliente sabe si su correo entra por 07201 o por 07202; el geocoder
      // devuelve el del polígono, que en un borde puede ser el de al lado.
      await build({ ...ELIZABETH, postalCode: '07208' });

      await service.create('user-1', dto({ postalCode: '07201' }));

      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({ postalCode: '07201' }),
      );
    });

    it('sin ZIP escrito, se usa el geocodificado Y con él se resuelve la zona', async () => {
      await build();

      await service.create('user-1', dto());

      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({ postalCode: '07201', zoneId: 'zone-nj' }),
      );
    });

    it('el número de puerta que escribió el cliente MANDA sobre el geocodificado', async () => {
      await build();

      await service.create('user-1', dto({ houseNumber: '1103' }));

      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({ houseNumber: '1103' }),
      );
    });

    it('sin número de puerta escrito, lo completa el geocoder', async () => {
      await build();

      await service.create('user-1', dto());

      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({ houseNumber: '1101' }),
      );
    });

    it('el estado/ciudad/condado que mande el cliente se IGNORAN: son del servidor', async () => {
      await build();

      await service.create(
        'user-1',
        dto({ state: 'NY', city: 'New York', county: 'Bronx County' } as Partial<CreateAddressDto>),
      );

      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({ state: 'NJ', city: 'Elizabeth', county: 'Union County' }),
      );
    });

    it('sella geocoded_at cuando el geocoder CONTESTÓ', async () => {
      // El sello es lo que saca la fila de la cola del backfill: sin él, una
      // dirección que el geocoder ya miró se re-procesa en cada vuelta.
      await build();

      await service.create('user-1', dto());

      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({ geocodedAt: expect.any(Date) }),
      );
    });

    it('un punto FUERA de NJ/NY igual queda sellado: el geocoder ya contestó', async () => {
      // Pennsylvania no está en el mapa de siglas, así que `state` queda null.
      // Sin el sello, el backfill (state IS NULL) la volvería a pedir para
      // siempre y gastaría la cuota de Nominatim en una fila sin respuesta útil.
      await build({ ...ELIZABETH, state: null, city: 'Philadelphia', county: null });

      await service.create('user-1', dto());

      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({ state: null, geocodedAt: expect.any(Date) }),
      );
    });

    it('sin respuesta del geocoder, geocoded_at queda en null', async () => {
      await build(null);

      await service.create('user-1', dto());

      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({ geocodedAt: null }),
      );
    });

    it('si el geocoder no contesta, la dirección se guarda IGUAL', async () => {
      // Nominatim caído no puede impedirle a un cliente guardar su casa.
      await build(null);

      const result = await service.create('user-1', dto({ postalCode: '07201' }));

      expect(repo.save).toHaveBeenCalled();
      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({ postalCode: '07201', zoneId: 'zone-nj', state: null }),
      );
      expect(result.taxRate).toBe(NJ_RATE);
    });
  });

  describe('update', () => {
    const existing = (overrides: Partial<UserAddress> = {}) =>
      fakeAddress({
        id: 'addr-1',
        userId: 'user-1',
        lat: 40.6639,
        lng: -74.2107,
        state: 'NJ',
        city: 'Elizabeth',
        county: 'Union County',
        postalCode: '07201',
        geocodedAt: new Date('2024-01-01T00:00:00.000Z'),
        ...overrides,
      });

    it('mover la chincheta vuelve a geocodificar', async () => {
      await build({
        houseNumber: '1728',
        road: 'Williamsbridge Road',
        city: 'New York',
        county: 'Bronx County',
        state: 'NY',
        postalCode: '10462',
        countryCode: 'us',
      });
      repo.findOne.mockResolvedValue(existing());

      const result = await service.update('user-1', 'addr-1', {
        lat: 40.8448,
        lng: -73.8648,
      });

      expect(geocoding.reverse).toHaveBeenCalledWith(40.8448, -73.8648);
      expect(result.state).toBe('NY');
      expect(result.city).toBe('New York');
      expect(result.county).toBe('Bronx County');
      // El ZIP viejo era de la chincheta VIEJA: mudarse de Elizabeth al Bronx
      // sin que el ZIP siga al punto dejaría la dirección cobrando NJ.
      expect(result.postalCode).toBe('10462');
    });

    it('un update que NO mueve la chincheta y ya tiene estado no gasta una llamada', async () => {
      // La política de Nominatim es 1 request/segundo: cada llamada de más es
      // un paso hacia el bloqueo por IP.
      await build();
      repo.findOne.mockResolvedValue(existing());

      await service.update('user-1', 'addr-1', { label: 'Oficina' });

      expect(geocoding.reverse).not.toHaveBeenCalled();
    });

    it('una fila vieja SIN estado se completa al editarla, aunque no se mueva', async () => {
      await build();
      repo.findOne.mockResolvedValue(existing() && fakeAddress({
        id: 'addr-1',
        userId: 'user-1',
        lat: 40.6639,
        lng: -74.2107,
        state: null,
      }));

      const result = await service.update('user-1', 'addr-1', { label: 'Oficina' });

      expect(geocoding.reverse).toHaveBeenCalledTimes(1);
      expect(result.state).toBe('NJ');
    });

    it('cambiar el ZIP a mano NO borra el estado ya derivado', async () => {
      await build();
      repo.findOne.mockResolvedValue(existing());

      const result = await service.update('user-1', 'addr-1', { postalCode: '07208' });

      expect(result.postalCode).toBe('07208');
      expect(result.state).toBe('NJ');
      expect(geocoding.reverse).not.toHaveBeenCalled();
    });

    it('mover la chincheta con el geocoder caído BORRA la jurisdicción vieja', async () => {
      // El estado guardado es el del punto VIEJO. Dejarlo puesto deja la
      // dirección cobrando New Jersey desde el Bronx para siempre: la fila
      // tiene estado, así que no vuelve a reintentar ni la agarra el backfill.
      await build(null);
      repo.findOne.mockResolvedValue(existing({ zoneId: 'zone-nj' }));

      const result = await service.update('user-1', 'addr-1', {
        lat: 40.8448,
        lng: -73.8648,
      });

      expect(result.state).toBeNull();
      expect(result.city).toBeNull();
      expect(result.county).toBeNull();
      // El ZIP guardado también era del punto viejo.
      expect(result.postalCode).toBeNull();
      expect(result.zoneId).toBeNull();
      // Sin sello: el backfill y el próximo update la vuelven a intentar.
      expect(result.geocodedAt).toBeNull();
    });

    it('el ZIP que el cliente mandó en ESE request sobrevive a la caída', async () => {
      // Lo que escribió el cliente recién no es un dato viejo: se respeta, y
      // con él se re-resuelve la zona.
      await build(null);
      repo.findOne.mockResolvedValue(existing({ zoneId: 'zone-nj' }));

      const result = await service.update('user-1', 'addr-1', {
        lat: 40.6640,
        lng: -74.2108,
        postalCode: '07208',
      });

      expect(result.postalCode).toBe('07208');
      expect(result.zoneId).toBe('zone-nj');
      expect(result.state).toBeNull();
    });

    it('una caída SIN mover la chincheta no borra nada', async () => {
      // Acá el reintento es sólo por "fila vieja sin estado": no hay ningún
      // dato viejo que contradiga al punto, así que no se toca nada.
      await build(null);
      repo.findOne.mockResolvedValue(
        fakeAddress({
          id: 'addr-1',
          userId: 'user-1',
          state: null,
          postalCode: '07201',
          zoneId: 'zone-nj',
        }),
      );

      const result = await service.update('user-1', 'addr-1', {
        label: 'Oficina',
      });

      expect(result.postalCode).toBe('07201');
      expect(result.zoneId).toBe('zone-nj');
      expect(result.geocodedAt).toBeNull();
    });

    it('volver a geocodificar re-sella geocoded_at', async () => {
      await build();
      repo.findOne.mockResolvedValue(existing({ geocodedAt: null }));

      const result = await service.update('user-1', 'addr-1', {
        lat: 40.6640,
        lng: -74.2108,
      });

      expect(result.geocodedAt).toEqual(expect.any(Date));
    });

    it('el número de puerta se puede editar', async () => {
      await build();
      repo.findOne.mockResolvedValue(existing());

      const result = await service.update('user-1', 'addr-1', { houseNumber: '1103' });

      expect(result.houseNumber).toBe('1103');
    });
  });

  describe('respuesta', () => {
    it('devuelve houseNumber, city, state, county, taxRate y taxJurisdiction', async () => {
      await build();

      const result = await service.create('user-1', dto());

      expect(result).toMatchObject({
        houseNumber: '1101',
        city: 'Elizabeth',
        state: 'NJ',
        county: 'Union County',
        taxRate: NJ_RATE,
        taxJurisdiction: 'NJ',
      });
    });
  });
});
