import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { UserRole } from '../../entities/enums';
import { AssociateBalanceService } from './associate-balance.service';
import { PoolService } from './pool.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('pool')
export class PoolController {
  constructor(
    private readonly pool: PoolService,
    private readonly balance: AssociateBalanceService,
  ) {}

  /** Pool del trimestre en curso. El super admin lo ve para auditar. */
  @Roles(UserRole.ASSOCIATE, UserRole.SUPER_ADMIN_DELIVERY)
  @Get('summary')
  summary() {
    return this.pool.getSummary();
  }

  /**
   * Saldo e historial propios. SIN `@Roles` a propósito: un ex asociado
   * conserva (y puede gastar) el saldo que ya se le repartió, y un cliente
   * común simplemente ve 0. Cerrarlo por rol dejaría a esos usuarios sin
   * poder ver su propio dinero.
   */
  @Get('me')
  async me(@CurrentUser() user: AuthenticatedUser) {
    const [balanceCents, entries] = await Promise.all([
      this.balance.getBalanceCents(user.id),
      this.balance.getHistory(user.id),
    ]);
    return {
      balanceCents,
      entries: entries.map((e) => ({
        id: e.id,
        type: e.type,
        amountCents: e.amountCents,
        orderId: e.orderId,
        quarter: e.distribution?.quarter ?? null,
        createdAt: e.createdAt.toISOString(),
      })),
    };
  }

  /** Historial de repartos trimestrales (más reciente primero). */
  @Roles(UserRole.SUPER_ADMIN_DELIVERY)
  @Get('distributions')
  async distributions() {
    const list = await this.pool.listDistributions();
    return list.map((d) => ({
      id: d.id,
      quarter: d.quarter,
      totalCents: d.totalCents,
      associateCount: d.associateCount,
      shareCents: d.shareCents,
      remainderCents: d.remainderCents,
      createdAt: d.createdAt.toISOString(),
    }));
  }
}
