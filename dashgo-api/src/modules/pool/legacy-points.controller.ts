import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { AssociateBalanceService } from './associate-balance.service';

/**
 * Compatibilidad con la app móvil vieja. Existe SOLO para que los builds que
 * son anteriores al pool sigan funcionando: esa app todavía le pregunta a
 * `/points/balance` cuánto puede gastar y pinta `/points/history`. Ya no hay
 * puntos de cliente; el único saldo gastable es el del asociado, así que un
 * asociado en un build viejo puede seguir gastándolo vía `claimableCents`
 * (junto con `usePoints` en el checkout) y todo lo demás vale 0.
 * Se puede borrar cuando ya no queden builds viejos instalados.
 */
@UseGuards(JwtAuthGuard)
@Controller('points')
export class LegacyPointsController {
  constructor(private readonly associateBalance: AssociateBalanceService) {}

  @Get('balance')
  async getBalance(@CurrentUser() user: AuthenticatedUser) {
    return {
      pendingCents: 0,
      claimableCents: await this.associateBalance.getBalanceCents(user.id),
      redeemedCents: 0,
      expiredCents: 0,
    };
  }

  @Get('history')
  getHistory() {
    return [];
  }
}
