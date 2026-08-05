import {
  BadRequestException,
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
   * Admin patch of another user: timer de mantenimiento, rol y asignación de
   * vendedor. SUPER_ADMIN_DELIVERY only — que la asignación de cartera sea
   * exclusiva del super admin es la regla que impide que un vendedor se lleve
   * los clientes de otro.
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

    if (dto.sellerId !== undefined && dto.sellerId !== null) {
      // Un cliente no puede quedar asignado a alguien que no es vendedor: sin
      // esta validación el scope de pedidos apuntaría a un id que nunca va a
      // poder abrir el panel, y el cliente quedaría invisible para todos.
      const seller = await this.users.findOne({
        where: { id: dto.sellerId },
      });
      if (!seller || seller.role !== UserRole.SELLER) {
        throw new BadRequestException({
          code: 'NOT_A_SELLER',
          message: 'El usuario asignado no tiene rol de vendedor',
        });
      }
      if (dto.sellerId === id) {
        throw new BadRequestException({
          code: 'SELF_ASSIGNMENT',
          message: 'Un usuario no puede ser su propio vendedor',
        });
      }
    }

    if (dto.role !== undefined && dto.role !== target.role) {
      // Escalada de privilegios: el super admin NO se reparte por HTTP. Se
      // provisiona por bootstrap/consola a propósito, así una sesión de admin
      // robada no puede fabricar otro admin.
      if (dto.role === UserRole.SUPER_ADMIN_DELIVERY) {
        throw new BadRequestException({
          code: 'CANNOT_GRANT_SUPER_ADMIN',
          message: 'El rol de super admin no se asigna desde el panel',
        });
      }
      // Auto-bloqueo: un admin que se degrada a sí mismo pierde el panel y no
      // tiene forma de volver.
      if (id === actor.id) {
        throw new BadRequestException({
          code: 'CANNOT_CHANGE_OWN_ROLE',
          message: 'No podés cambiar tu propio rol',
        });
      }
    }

    // Degradar a un vendedor deja a TODA su cartera apuntando a alguien que ya
    // no es vendedor: esos clientes desaparecen del panel de todos (el scope
    // busca `seller_id` de un seller). Se desasignan en la misma transacción
    // que el cambio de rol — nunca en dos pasos.
    const losesSellerRole =
      target.role === UserRole.SELLER &&
      dto.role !== undefined &&
      dto.role !== UserRole.SELLER;

    await this.users.manager.transaction(async (tx) => {
      await tx.getRepository(User).update(id, dto);
      if (losesSellerRole) {
        await tx
          .getRepository(User)
          .update({ sellerId: id }, { sellerId: null });
      }
    });

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
    if (
      user.role !== UserRole.SUPER_ADMIN_DELIVERY &&
      user.role !== UserRole.SELLER
    ) {
      throw new ForbiddenException();
    }

    const qb = this.users
      .createQueryBuilder('user')
      .leftJoin(Subscription, 'subscription', 'subscription.user_id = user.id')
      .addSelect('subscription.status', 'subscription_status')
      .orderBy('user.createdAt', 'DESC');

    // El vendedor ve SOLO los usuarios de su cartera. Sin este filtro, el panel
    // de usuarios le entregaría la base de clientes completa — es el agujero
    // grande de este rol, y va acá y no en el front.
    if (user.role === UserRole.SELLER) {
      qb.andWhere('user.seller_id = :sellerId', { sellerId: user.id });
    }

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
