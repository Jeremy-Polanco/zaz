import { Controller, Get, Param, ParseUUIDPipe, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { InvoicesService } from './invoices.service';

@UseGuards(JwtAuthGuard)
@Controller('orders')
export class InvoicesController {
  constructor(private readonly invoices: InvoicesService) {}

  @Get(':id/invoice')
  getInvoice(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.invoices.getByOrderId(id, user);
  }
}
