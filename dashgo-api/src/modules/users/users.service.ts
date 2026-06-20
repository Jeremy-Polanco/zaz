import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Subscription, SubscriptionStatus, User } from '../../entities';
import { UserRole } from '../../entities/enums';
import { AuthenticatedUser } from '../../common/types/authenticated-user';
import { AuthService } from '../auth/auth.service';
import { UpdateMeDto } from './dto/update-me.dto';
import { UpdateUserAdminDto } from './dto/update-user-admin.dto';
import {
  ListUsersQueryDto,
  UserSubscriptionFilter,
} from './dto/list-users-query.dto';

/**
 * A User enriched with its current subscription status, as returned by the
 * admin GET /users endpoint. All original User fields are preserved.
 */
export type AdminUser = User & {
  hasActiveSubscription: boolean;
  subscriptionStatus: SubscriptionStatus | null;
};

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly auth: AuthService,
  ) {}

  async getMe(user: AuthenticatedUser) {
    const me = await this.users.findOne({ where: { id: user.id } });
    if (!me) throw new NotFoundException();
    return me;
  }

  async updateMe(user: AuthenticatedUser, dto: UpdateMeDto) {
    await this.users.update(user.id, dto);
    return this.getMe(user);
  }

  /**
   * Admin patch of another user. Currently only the bebedero maintenance timer
   * switch. SUPER_ADMIN_DELIVERY only.
   */
  async updateByAdmin(
    actor: AuthenticatedUser,
    id: string,
    dto: UpdateUserAdminDto,
  ): Promise<User> {
    if (actor.role !== UserRole.SUPER_ADMIN_DELIVERY) {
      throw new ForbiddenException();
    }
    const target = await this.users.findOne({ where: { id } });
    if (!target) throw new NotFoundException();
    await this.users.update(id, dto);
    const updated = await this.users.findOne({ where: { id } });
    if (!updated) throw new NotFoundException();
    return updated;
  }

  /**
   * Admin "delete user". SUPER_ADMIN_DELIVERY only. Hard-deletes the target via
   * the shared AuthService.deleteAccount flow — same transaction, order
   * anonymization, RESTRICT-FK cleanup, durable audit row and Stripe cleanup as
   * self-service deletion — but tags the audit as admin-initiated and records
   * which admin did it.
   *
   * An admin cannot delete their own account through this endpoint (guardrail
   * against self-lockout / accidents). They can still use DELETE /auth/me for a
   * deliberate self-deletion.
   */
  async deleteByAdmin(actor: AuthenticatedUser, id: string): Promise<void> {
    if (actor.role !== UserRole.SUPER_ADMIN_DELIVERY) {
      throw new ForbiddenException();
    }
    if (actor.id === id) {
      throw new ForbiddenException(
        'No podés eliminar tu propia cuenta de administrador desde acá.',
      );
    }
    const target = await this.users.findOne({ where: { id } });
    if (!target) throw new NotFoundException();
    await this.auth.deleteAccount(id, {
      requestedVia: 'admin',
      requestedByUserId: actor.id,
    });
  }

  /**
   * Admin "list users". Returns every User field, plus its current
   * subscription status (`subscriptionStatus`) and a `hasActiveSubscription`
   * flag. Optionally filters by subscription presence.
   *
   *   filter.subscription = 'active' → only users with an active subscription
   *   filter.subscription = 'none'   → only users without an active subscription
   *   undefined                      → all users
   *
   * Ordered by createdAt DESC.
   */
  async findAll(
    user: AuthenticatedUser,
    filter: ListUsersQueryDto = {},
  ): Promise<AdminUser[]> {
    if (user.role !== UserRole.SUPER_ADMIN_DELIVERY) {
      throw new ForbiddenException();
    }

    const qb = this.users
      .createQueryBuilder('user')
      .leftJoin(Subscription, 'subscription', 'subscription.user_id = user.id')
      .addSelect('subscription.status', 'subscription_status')
      .orderBy('user.createdAt', 'DESC');

    if (filter.subscription === UserSubscriptionFilter.ACTIVE) {
      qb.andWhere('subscription.status = :activeStatus', {
        activeStatus: SubscriptionStatus.ACTIVE,
      });
    } else if (filter.subscription === UserSubscriptionFilter.NONE) {
      qb.andWhere(
        '(subscription.status IS NULL OR subscription.status <> :activeStatus)',
        { activeStatus: SubscriptionStatus.ACTIVE },
      );
    }

    const { entities, raw } = await qb.getRawAndEntities<{
      subscription_status: SubscriptionStatus | null;
    }>();

    return entities.map((entity, i) => {
      const status = raw[i]?.subscription_status ?? null;
      return Object.assign(entity, {
        hasActiveSubscription: status === SubscriptionStatus.ACTIVE,
        subscriptionStatus: status,
      });
    });
  }
}
