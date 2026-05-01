import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ShippingService } from './shipping.service';
import { ComputeShippingDto } from './dto/compute-shipping.dto';

@UseGuards(JwtAuthGuard)
@Controller('shipping')
export class ShippingController {
  constructor(private readonly shipping: ShippingService) {}

  @Post('quote')
  quote(@Body() dto: ComputeShippingDto) {
    return this.shipping.computeQuote({ lat: dto.lat, lng: dto.lng });
  }
}
