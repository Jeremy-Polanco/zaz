/**
 * Unit specs for ShippingService.getOrigin().
 *
 * Repository<User>, Repository<UserAddress> and ConfigService are mocked.
 * Focus: the resolution order of the shipping origin —
 *   active location → default address → legacy addressDefault → null.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { ShippingService } from './shipping.service';
import { User } from '../../entities/user.entity';
import { UserAddress } from '../../entities/user-address.entity';
import { UserRole } from '../../entities/enums';

function makeUserRepoMock(): jest.Mocked<Repository<User>> {
  return { findOne: jest.fn() } as unknown as jest.Mocked<Repository<User>>;
}

function makeAddressRepoMock(): jest.Mocked<Repository<UserAddress>> {
  return {
    findOne: jest.fn(),
  } as unknown as jest.Mocked<Repository<UserAddress>>;
}

function fakeAdmin(overrides: Partial<User> = {}): User {
  return {
    id: 'admin-1',
    role: UserRole.SUPER_ADMIN_DELIVERY,
    activeLocationId: null,
    addressDefault: null,
    createdAt: new Date('2024-01-01T00:00:00.000Z'),
    ...overrides,
  } as unknown as User;
}

function fakeAddress(overrides: Partial<UserAddress> = {}): UserAddress {
  return {
    id: 'addr-1',
    userId: 'admin-1',
    label: 'Colmado',
    line1: 'Calle 1',
    line2: null,
    building: null,
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

describe('ShippingService — getOrigin', () => {
  let service: ShippingService;
  let users: jest.Mocked<Repository<User>>;
  let addresses: jest.Mocked<Repository<UserAddress>>;

  beforeEach(async () => {
    users = makeUserRepoMock();
    addresses = makeAddressRepoMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ShippingService,
        { provide: getRepositoryToken(User), useValue: users },
        { provide: getRepositoryToken(UserAddress), useValue: addresses },
        { provide: ConfigService, useValue: { get: jest.fn((_k, d) => d) } },
      ],
    }).compile();

    service = module.get<ShippingService>(ShippingService);
  });

  it('returns null when there is no repartidor', async () => {
    users.findOne.mockResolvedValue(null);

    const origin = await service.getOrigin();

    expect(origin).toBeNull();
    expect(addresses.findOne).not.toHaveBeenCalled();
  });

  it('prefers the explicitly selected active location', async () => {
    users.findOne.mockResolvedValue(
      fakeAdmin({ activeLocationId: 'addr-active' }),
    );
    addresses.findOne.mockResolvedValue(
      fakeAddress({ id: 'addr-active', lat: 1, lng: 2 }),
    );

    const origin = await service.getOrigin();

    expect(addresses.findOne).toHaveBeenCalledWith({
      where: { id: 'addr-active', userId: 'admin-1' },
    });
    expect(origin).toEqual({ lat: 1, lng: 2 });
  });

  it('falls back to the default address when no active location is set', async () => {
    users.findOne.mockResolvedValue(fakeAdmin({ activeLocationId: null }));
    addresses.findOne.mockResolvedValue(
      fakeAddress({ id: 'addr-default', isDefault: true, lat: 3, lng: 4 }),
    );

    const origin = await service.getOrigin();

    expect(addresses.findOne).toHaveBeenCalledWith({
      where: { userId: 'admin-1', isDefault: true },
    });
    expect(origin).toEqual({ lat: 3, lng: 4 });
  });

  it('falls back to the default address when the active location is missing/deleted', async () => {
    users.findOne.mockResolvedValue(
      fakeAdmin({ activeLocationId: 'gone' }),
    );
    addresses.findOne
      .mockResolvedValueOnce(null) // active lookup misses
      .mockResolvedValueOnce(
        fakeAddress({ id: 'addr-default', isDefault: true, lat: 5, lng: 6 }),
      );

    const origin = await service.getOrigin();

    expect(origin).toEqual({ lat: 5, lng: 6 });
  });

  it('falls back to legacy addressDefault when no UserAddress rows exist', async () => {
    users.findOne.mockResolvedValue(
      fakeAdmin({ addressDefault: { text: 'X', lat: 7, lng: 8 } }),
    );
    addresses.findOne.mockResolvedValue(null);

    const origin = await service.getOrigin();

    expect(origin).toEqual({ lat: 7, lng: 8 });
  });

  it('returns null when nothing has usable coordinates', async () => {
    users.findOne.mockResolvedValue(fakeAdmin({ addressDefault: null }));
    addresses.findOne.mockResolvedValue(null);

    const origin = await service.getOrigin();

    expect(origin).toBeNull();
  });
});
