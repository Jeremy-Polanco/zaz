/**
 * Unit specs for UsersService.findAll — admin "list users" endpoint.
 *
 * Covers the subscription-status enrichment + filter contract:
 *   - user WITH active subscription → hasActiveSubscription true, subscriptionStatus 'active'
 *   - user WITHOUT any subscription row → hasActiveSubscription false, subscriptionStatus null
 *   - user with a non-active subscription → hasActiveSubscription false, subscriptionStatus '<status>'
 *   - subscription=active → only active users (filter pushed to query)
 *   - subscription=none   → only non-active users (filter pushed to query)
 *   - ordering stays createdAt DESC
 *
 * Repositories are injected as jest mocks. No real DB.
 */

import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { UsersService } from './users.service';
import { AuthService } from '../auth/auth.service';
import { User } from '../../entities/user.entity';
import { SubscriptionStatus } from '../../entities/subscription.entity';
import { UserRole } from '../../entities/enums';
import { UserSubscriptionFilter } from './dto/list-users-query.dto';
import { AuthenticatedUser } from '../../common/types/authenticated-user';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeUserRepoMock() {
  const qb = {
    leftJoin: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    getRawAndEntities: jest.fn().mockResolvedValue({ entities: [], raw: [] }),
  };

  return {
    findOne: jest.fn(),
    find: jest.fn(),
    update: jest.fn(),
    createQueryBuilder: jest.fn().mockReturnValue(qb),
    _qb: qb,
  };
}

function fakeUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user-1',
    fullName: 'Test User',
    email: 'test@test.com',
    phone: '+1234567890',
    role: UserRole.CLIENT,
    createdAt: new Date('2024-01-01T10:00:00Z'),
    ...overrides,
  } as User;
}

const admin: AuthenticatedUser = {
  id: 'admin-1',
  role: UserRole.SUPER_ADMIN_DELIVERY,
} as AuthenticatedUser;

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('UsersService.findAll (admin list)', () => {
  let service: UsersService;
  let userRepo: ReturnType<typeof makeUserRepoMock>;

  beforeEach(async () => {
    userRepo = makeUserRepoMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: AuthService, useValue: { deleteAccount: jest.fn() } },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  it('rejects non-admin callers with ForbiddenException', async () => {
    const client = { id: 'u', role: UserRole.CLIENT } as AuthenticatedUser;
    await expect(service.findAll(client, {})).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('user WITH active subscription → hasActiveSubscription true, subscriptionStatus "active"', async () => {
    const u = fakeUser({ id: 'u-active' });
    userRepo._qb.getRawAndEntities.mockResolvedValueOnce({
      entities: [u],
      raw: [{ subscription_status: SubscriptionStatus.ACTIVE }],
    });

    const result = await service.findAll(admin, {});

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('u-active');
    expect(result[0].hasActiveSubscription).toBe(true);
    expect(result[0].subscriptionStatus).toBe(SubscriptionStatus.ACTIVE);
    // Existing User fields preserved
    expect(result[0].email).toBe('test@test.com');
    expect(result[0].fullName).toBe('Test User');
  });

  it('user WITHOUT any subscription row → hasActiveSubscription false, subscriptionStatus null', async () => {
    const u = fakeUser({ id: 'u-none' });
    userRepo._qb.getRawAndEntities.mockResolvedValueOnce({
      entities: [u],
      raw: [{ subscription_status: null }],
    });

    const result = await service.findAll(admin, {});

    expect(result[0].hasActiveSubscription).toBe(false);
    expect(result[0].subscriptionStatus).toBeNull();
  });

  it('user with a NON-active subscription → hasActiveSubscription false, subscriptionStatus keeps the value', async () => {
    const u = fakeUser({ id: 'u-pastdue' });
    userRepo._qb.getRawAndEntities.mockResolvedValueOnce({
      entities: [u],
      raw: [{ subscription_status: SubscriptionStatus.PAST_DUE }],
    });

    const result = await service.findAll(admin, {});

    expect(result[0].hasActiveSubscription).toBe(false);
    expect(result[0].subscriptionStatus).toBe(SubscriptionStatus.PAST_DUE);
  });

  it('orders by createdAt DESC', async () => {
    await service.findAll(admin, {});
    expect(userRepo._qb.orderBy).toHaveBeenCalledWith('user.createdAt', 'DESC');
  });

  it('subscription=active → pushes the active filter into the query', async () => {
    const u = fakeUser({ id: 'u-active' });
    userRepo._qb.getRawAndEntities.mockResolvedValueOnce({
      entities: [u],
      raw: [{ subscription_status: SubscriptionStatus.ACTIVE }],
    });

    const result = await service.findAll(admin, {
      subscription: UserSubscriptionFilter.ACTIVE,
    });

    expect(userRepo._qb.andWhere).toHaveBeenCalledWith(
      expect.stringContaining('subscription.status = :activeStatus'),
      expect.objectContaining({ activeStatus: SubscriptionStatus.ACTIVE }),
    );
    expect(result).toHaveLength(1);
    expect(result[0].hasActiveSubscription).toBe(true);
  });

  it('subscription=none → pushes the non-active filter into the query', async () => {
    const u = fakeUser({ id: 'u-none' });
    userRepo._qb.getRawAndEntities.mockResolvedValueOnce({
      entities: [u],
      raw: [{ subscription_status: null }],
    });

    const result = await service.findAll(admin, {
      subscription: UserSubscriptionFilter.NONE,
    });

    expect(userRepo._qb.andWhere).toHaveBeenCalledWith(
      expect.stringContaining('subscription.status IS NULL'),
      expect.objectContaining({ activeStatus: SubscriptionStatus.ACTIVE }),
    );
    expect(result).toHaveLength(1);
    expect(result[0].hasActiveSubscription).toBe(false);
    expect(result[0].subscriptionStatus).toBeNull();
  });
});

describe('UsersService.updateByAdmin', () => {
  let service: UsersService;
  let userRepo: ReturnType<typeof makeUserRepoMock>;

  beforeEach(async () => {
    userRepo = makeUserRepoMock();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: AuthService, useValue: { deleteAccount: jest.fn() } },
      ],
    }).compile();
    service = module.get<UsersService>(UsersService);
  });

  it('rejects non-admin callers', async () => {
    const client = { id: 'u', role: UserRole.CLIENT } as AuthenticatedUser;
    await expect(
      service.updateByAdmin(client, 'target-1', { maintenanceTimerDisabled: true }),
    ).rejects.toThrow(ForbiddenException);
    expect(userRepo.update).not.toHaveBeenCalled();
  });

  it('toggles maintenanceTimerDisabled on the target user', async () => {
    userRepo.findOne
      .mockResolvedValueOnce(fakeUser({ id: 'target-1', maintenanceTimerDisabled: false }))
      .mockResolvedValueOnce(fakeUser({ id: 'target-1', maintenanceTimerDisabled: true }));

    const result = await service.updateByAdmin(admin, 'target-1', {
      maintenanceTimerDisabled: true,
    });

    expect(userRepo.update).toHaveBeenCalledWith('target-1', {
      maintenanceTimerDisabled: true,
    });
    expect(result.maintenanceTimerDisabled).toBe(true);
  });

  it('throws NotFound when the target user does not exist', async () => {
    userRepo.findOne.mockResolvedValueOnce(null);
    await expect(
      service.updateByAdmin(admin, 'ghost', { maintenanceTimerDisabled: true }),
    ).rejects.toThrow(NotFoundException);
  });
});

describe('UsersService.deleteByAdmin', () => {
  let service: UsersService;
  let userRepo: ReturnType<typeof makeUserRepoMock>;
  let auth: { deleteAccount: jest.Mock };

  beforeEach(async () => {
    userRepo = makeUserRepoMock();
    auth = { deleteAccount: jest.fn().mockResolvedValue(undefined) };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: AuthService, useValue: auth },
      ],
    }).compile();
    service = module.get<UsersService>(UsersService);
  });

  it('rejects non-admin callers and never deletes', async () => {
    const client = { id: 'u', role: UserRole.CLIENT } as AuthenticatedUser;
    await expect(service.deleteByAdmin(client, 'target-1')).rejects.toThrow(
      ForbiddenException,
    );
    expect(auth.deleteAccount).not.toHaveBeenCalled();
  });

  it('blocks an admin from deleting their own account', async () => {
    await expect(service.deleteByAdmin(admin, admin.id)).rejects.toThrow(
      ForbiddenException,
    );
    expect(auth.deleteAccount).not.toHaveBeenCalled();
  });

  it('deletes the target via AuthService, tagging the audit as admin-initiated', async () => {
    userRepo.findOne.mockResolvedValueOnce(fakeUser({ id: 'target-1' }));

    await service.deleteByAdmin(admin, 'target-1');

    expect(auth.deleteAccount).toHaveBeenCalledWith('target-1', {
      requestedVia: 'admin',
      requestedByUserId: admin.id,
    });
  });

  it('throws NotFound when the target user does not exist', async () => {
    userRepo.findOne.mockResolvedValueOnce(null);
    await expect(service.deleteByAdmin(admin, 'ghost')).rejects.toThrow(
      NotFoundException,
    );
    expect(auth.deleteAccount).not.toHaveBeenCalled();
  });
});
