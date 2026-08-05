import { Controller, Get, Param, ParseUUIDPipe, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../common/types/authenticated-user';
import { UserRole } from '../../entities/enums';
import { SellersService } from './sellers.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('sellers')
export class SellersController {
  constructor(private readonly sellers: SellersService) {}

  /**
   * Cuánto hay que pagarle a cada vendedor, separado por tarjeta y efectivo.
   * Declarado ANTES de `:sellerId/earnings` — si no, ParseUUIDPipe atraparía
   * "payable".
   */
  @Roles(UserRole.SUPER_ADMIN_DELIVERY)
  @Get('payable')
  payable(@CurrentUser() user: AuthenticatedUser) {
    return this.sellers.getPayableSummary(user);
  }

  /** Mis ingresos (vendedor) o los de cualquiera (super admin). */
  @Roles(UserRole.SUPER_ADMIN_DELIVERY, UserRole.SELLER)
  @Get(':sellerId/earnings')
  earnings(
    @CurrentUser() user: AuthenticatedUser,
    @Param('sellerId', ParseUUIDPipe) sellerId: string,
  ) {
    return this.sellers.getEarnings(sellerId, user);
  }
}
