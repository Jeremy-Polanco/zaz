import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../entities/enums';
import { SubscriptionService } from './subscription.service';
import { ChargeLateFeeRequestDto } from './dto/charge-late-fee-request.dto';
import { ChargeLateFeeResponseDto } from './dto/charge-late-fee-response.dto';
import { SubscriptionResponseDto } from './dto/subscription-response.dto';
import { AdminUserSubscriptionDto } from './dto/admin-user-subscription.dto';

/**
 * Admin endpoints for per-resource rental/purchase management.
 * All routes require SUPER_ADMIN_DELIVERY role.
 *
 * Routes (no class-level prefix — full paths declared per method):
 *   POST /admin/users/:userId/subscription/activate-rental  — create rental subscription
 *   POST /admin/users/:userId/subscription/activate-purchase — one-time purchase
 *   POST /admin/subscriptions/:id/charge-late-fee           — charge late fee (+ optional cancel)
 *   POST /admin/subscriptions/:id/cancel                    — cancel rental subscription
 */
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN_DELIVERY)
@Controller()
export class AdminRentalController {
  constructor(private readonly subscription: SubscriptionService) {}

  /**
   * GET /admin/users/:userId/subscription
   * Returns the user's current subscription (or null) plus hasPaymentMethod boolean.
   * Used by the web admin Dispenser section to determine the current state and
   * whether activation buttons should be enabled.
   */
  @Get('admin/users/:userId/subscription')
  @HttpCode(HttpStatus.OK)
  async getUserSubscription(
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<AdminUserSubscriptionDto> {
    return this.subscription.getAdminUserSubscription(userId);
  }

  /**
   * POST /admin/users/:userId/subscription/activate-rental
   * Creates a Stripe Subscription for the user and writes the DB row.
   * Returns 201 SubscriptionResponseDto on success.
   * Throws:
   *   400 NO_PAYMENT_METHOD — user has no stripeCustomerId
   *   404 USER_NOT_FOUND   — no user with given userId
   *   409 ALREADY_ACTIVE   — user already has an active subscription
   *   502 STRIPE_*         — Stripe API failure
   */
  @Post('admin/users/:userId/subscription/activate-rental')
  @HttpCode(HttpStatus.CREATED)
  async activateAsRental(
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<SubscriptionResponseDto> {
    return this.subscription.activateAsRental(userId);
  }

  /**
   * POST /admin/users/:userId/subscription/activate-purchase
   * Creates a Stripe PaymentIntent and writes the DB row with model='purchase'.
   * Returns 201 SubscriptionResponseDto on success.
   * Throws:
   *   400 NO_PAYMENT_METHOD             — user has no stripeCustomerId
   *   402 REQUIRES_ACTION               — SCA challenge required
   *   404 USER_NOT_FOUND               — no user with given userId
   *   409 ALREADY_ACTIVE               — user already has an active subscription
   *   502 STRIPE_PURCHASE_FAILED       — Stripe API failure
   *   503 PURCHASE_PRICE_NOT_CONFIGURED — plan.purchasePriceCents = 0
   */
  @Post('admin/users/:userId/subscription/activate-purchase')
  @HttpCode(HttpStatus.CREATED)
  async activateAsPurchase(
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<SubscriptionResponseDto> {
    return this.subscription.activateAsPurchase(userId);
  }

  /**
   * POST /admin/subscriptions/:id/charge-late-fee
   * Charges the late fee for a rental subscription via Stripe PaymentIntent.
   * Body: { alsoCancel: boolean } — if true, also cancels the subscription.
   * Returns 200 ChargeLateFeeResponseDto on success.
   * Throws:
   *   400 NOT_A_RENTAL             — subscription has model='purchase'
   *   404                          — subscription not found
   *   502 STRIPE_PAYMENT_FAILED   — Stripe API failure
   *   503 LATE_FEE_NOT_CONFIGURED — plan.lateFeeCents = 0
   */
  @Post('admin/subscriptions/:id/charge-late-fee')
  @HttpCode(HttpStatus.OK)
  async chargeLateFee(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ChargeLateFeeRequestDto,
  ): Promise<ChargeLateFeeResponseDto> {
    return this.subscription.chargeLateFee(id, dto.alsoCancel);
  }

  /**
   * POST /admin/subscriptions/:id/cancel
   * Cancels a rental subscription via Stripe and updates the local DB row.
   * Idempotent: returns 200 even if subscription is already canceled.
   * Returns 200 SubscriptionResponseDto on success.
   * Throws:
   *   400 NOT_A_RENTAL — subscription has model='purchase'
   *   404              — subscription not found
   *   502 STRIPE_*     — Stripe API failure
   */
  @Post('admin/subscriptions/:id/cancel')
  @HttpCode(HttpStatus.OK)
  async cancelAdmin(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<SubscriptionResponseDto> {
    return this.subscription.cancelAdmin(id);
  }
}
