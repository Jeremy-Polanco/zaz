import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { OrdersService } from './orders.service';
import { CreateOrderDto, DeliveryAddressDto } from './dto/create-order.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { SetQuoteDto } from './dto/set-quote.dto';

@UseGuards(JwtAuthGuard)
@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get()
  findAll(@CurrentUser() user: AuthenticatedUser) {
    return this.orders.findAll(user);
  }

  /** Admin dashboard: who ordered today / who's been quiet 7d and 30d. */
  @Get('admin/customer-activity')
  customerActivity(@CurrentUser() user: AuthenticatedUser) {
    return this.orders.getCustomerActivity(user);
  }

  /** Admin hard-delete — only CANCELLED orders (cancel first reverses money). */
  @Delete(':id')
  deleteOrder(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.orders.deleteOrder(id, user);
  }

  @Get(':id')
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.orders.findOne(id, user);
  }

  @Post()
  create(
    @Body() dto: CreateOrderDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    // Customer-initiated orders may intentionally stack rentals (e.g. a second
    // bebedero, billed at the additional rate). The auto free-bebedero
    // provisioning calls orders.create() WITHOUT this flag, so it stays
    // idempotent against replayed Stripe webhooks.
    return this.orders.create(user, dto, { allowDuplicateRental: true });
  }

  @Patch(':id/status')
  updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateOrderStatusDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.orders.updateStatus(id, dto, user);
  }

  @Patch(':id/quote')
  setQuote(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetQuoteDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.orders.setQuote(id, dto.shippingCents, user);
  }

  /** Super-admin pins the delivery location at delivery time. */
  @Patch(':id/delivery-address')
  setDeliveryAddress(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DeliveryAddressDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.orders.setDeliveryAddress(id, dto, user);
  }

  @Post(':id/authorize')
  authorize(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.orders.authorize(id, user);
  }

  /** New canonical route — for cash and full-credit orders */
  @Post(':id/confirm-non-stripe')
  confirmNonStripe(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.orders.confirmNonStripeOrder(id, user);
  }

  /** Backward-compatible alias — kept to avoid breaking existing clients */
  @Post(':id/confirm-cash')
  confirmCash(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.orders.confirmNonStripeOrder(id, user);
  }
}
