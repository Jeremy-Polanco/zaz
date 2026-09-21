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
import { DeliveryZonesService } from './delivery-zones.service';
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
  resolved: { zoneId: string | null; taxRate: number } = {
    zoneId: null,
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
    city: null,
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
        { provide: DeliveryZonesService, useValue: makeZoneRatesMock() },
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
      { ...addrB, taxRate: TAX_RATE },
      { ...addrA, taxRate: TAX_RATE },
      { ...addrC, taxRate: TAX_RATE },
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
        { provide: DeliveryZonesService, useValue: makeZoneRatesMock() },
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
    expect(result).toEqual({ ...saved, taxRate: TAX_RATE });
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
        { provide: DeliveryZonesService, useValue: makeZoneRatesMock() },
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
        { provide: DeliveryZonesService, useValue: makeZoneRatesMock() },
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
        { provide: DeliveryZonesService, useValue: makeZoneRatesMock() },
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
        { provide: DeliveryZonesService, useValue: makeZoneRatesMock() },
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
    expect(result).toEqual(addresses.map((a) => ({ ...a, taxRate: TAX_RATE })));
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
        { provide: DeliveryZonesService, useValue: makeZoneRatesMock() },
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
    expect(result).toEqual({ ...target, taxRate: TAX_RATE });
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
        { provide: DeliveryZonesService, useValue: makeZoneRatesMock() },
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

  const build = async (resolved?: { zoneId: string | null; taxRate: number }) => {
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
        { provide: DeliveryZonesService, useValue: zoneRates },
      ],
    }).compile();
    service = module.get<AddressesService>(AddressesService);
  };

  it('una dirección con zona de New Jersey responde 6.625%', async () => {
    await build({ zoneId: 'zone-nj', taxRate: NJ_RATE });
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
    await build({ zoneId: 'zone-nj', taxRate: NJ_RATE });
    repo.find.mockResolvedValue([
      fakeAddress({ id: 'a1', zoneId: 'zone-nj', postalCode: '07201' }),
    ]);

    await service.list('user-1');

    expect(zoneRates.resolveTaxRates).toHaveBeenCalledWith([
      { zoneId: 'zone-nj', postalCode: '07201' },
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
    await build({ zoneId: 'zone-nj', taxRate: NJ_RATE });
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
