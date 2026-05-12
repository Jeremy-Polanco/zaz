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
import { CreateAddressDto } from './dto/create-address.dto';
import { UpdateAddressDto } from './dto/update-address.dto';

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
    lat: 18.47,
    lng: -69.9,
    instructions: null,
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
        { provide: DataSource, useValue: ds },
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
    expect(result).toEqual([addrB, addrA, addrC]);
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
        { provide: DataSource, useValue: ds },
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
    expect(result).toBe(saved);
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
        { provide: DataSource, useValue: ds },
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
        { provide: DataSource, useValue: { transaction: dsTransactionMock } },
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
        { provide: DataSource, useValue: { transaction: dsTransactionMock } },
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
        { provide: DataSource, useValue: ds },
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
    expect(result).toEqual(addresses);
  });

  it('returns empty array for user with no addresses', async () => {
    repo.find.mockResolvedValue([]);
    const result = await service.listByUserId('user-other');
    expect(result).toEqual([]);
  });
});
