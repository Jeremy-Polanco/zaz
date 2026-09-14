import { Body, Controller, Get, Post, Put, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../entities/enums';
import { ShippingService } from './shipping.service';
import { ShippingRateService } from './shipping-rate.service';
import { ComputeShippingDto } from './dto/compute-shipping.dto';
import { UpdateShippingRateDto } from './dto/update-shipping-rate.dto';

/**
 * Envíos: la cotización por distancia y la tarifa plana editable.
 *
 *   POST /shipping/quote — recargo por distancia (admin, con sesión)
 *   GET  /shipping/rate  — tarifa vigente (PÚBLICA)
 *   PUT  /shipping/rate  — el super admin la cambia
 *
 * `RolesGuard` sube a nivel de clase pero no aprieta nada de más: sin `@Roles`
 * en el handler deja pasar (ver roles.guard.ts), así que `POST quote` sigue
 * exactamente como estaba.
 *
 * El GET va `@Public()` porque el checkout tiene que poder mostrar el envío
 * ANTES del login — el catálogo es navegable como invitado y si la tarifa
 * pidiera sesión el total del carrito quedaría mintiendo hasta que el cliente
 * se loguee. No hay nada sensible en un número que igual aparece en cada
 * pedido.
 */
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('shipping')
export class ShippingController {
  constructor(
    private readonly shipping: ShippingService,
    private readonly rate: ShippingRateService,
  ) {}

  @Post('quote')
  quote(@Body() dto: ComputeShippingDto) {
    return this.shipping.computeQuote({ lat: dto.lat, lng: dto.lng });
  }

  @Public()
  @Get('rate')
  async getRate(): Promise<{ shippingCents: number }> {
    return { shippingCents: await this.rate.getFlatShippingCents() };
  }

  @Roles(UserRole.SUPER_ADMIN_DELIVERY)
  @Put('rate')
  async setRate(
    @Body() dto: UpdateShippingRateDto,
  ): Promise<{ shippingCents: number }> {
    return {
      shippingCents: await this.rate.setFlatShippingCents(dto.shippingCents),
    };
  }
}
