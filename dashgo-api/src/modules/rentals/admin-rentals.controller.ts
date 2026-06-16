import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../entities/enums';
import { RentalsService } from './rentals.service';
import { ListRentalsQueryDto } from './dto/list-rentals-query.dto';
import { ChargeLateFeeDto } from './dto/charge-late-fee.dto';
import { AdminRentalResponseDto } from './dto/admin-rental-response.dto';
import { ChargeLateFeeResponseDto } from './dto/charge-late-fee-response.dto';
import { ChargeTheftFeeResponseDto } from './dto/charge-theft-fee-response.dto';

/**
 * Admin endpoints for rental management.
 * All routes require SUPER_ADMIN_DELIVERY role.
 *
 * Routes:
 *   GET  /admin/rentals             — list rentals with optional filters
 *   GET  /admin/rentals/delinquent  — list overdue / stale rentals
 *   POST /admin/rentals/:id/charge-late-fee  — charge late fee off-session
 *   POST /admin/rentals/:id/cancel           — cancel rental + Stripe sub
 *   POST /admin/rentals/:id/retry-setup      — retry Stripe Subscription creation
 *
 * NOTE: static sub-route GET /admin/rentals/delinquent MUST be declared before
 * any dynamic :id route (would conflict if GET /:id existed). Currently no such
 * conflict exists — only POSTs use :id.
 */
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN_DELIVERY)
@Controller('admin/rentals')
export class AdminRentalsController {
  constructor(private readonly rentals: RentalsService) {}

  /**
   * GET /admin/rentals
   * Returns a paginated list of rentals with optional filters.
   * Query params: status (multi), userId, productId, page, pageSize.
   */
  @Get()
  async list(
    @Query() query: ListRentalsQueryDto,
  ): Promise<{ items: AdminRentalResponseDto[]; total: number }> {
    return this.rentals.listAdmin({
      status: query.status,
      userId: query.userId,
      productId: query.productId,
      page: query.page,
      pageSize: query.pageSize,
    });
  }

  /**
   * GET /admin/rentals/delinquent
   * Returns rentals that are overdue (past_due/unpaid past period end) or
   * stuck in pending_setup for > 24 hours.
   */
  @Get('delinquent')
  async delinquent(): Promise<AdminRentalResponseDto[]> {
    return this.rentals.listDelinquent();
  }

  /**
   * POST /admin/rentals/:id/charge-late-fee
   * Charges the rental's lateFeeCents off-session via Stripe PaymentIntent.
   * Optional body { alsoCancel: true } also cancels the Stripe Subscription.
   * Returns 503 if lateFeeCents = 0, 502 if Stripe fails.
   */
  @Post(':id/charge-late-fee')
  @HttpCode(200)
  async chargeLateFee(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ChargeLateFeeDto,
  ): Promise<ChargeLateFeeResponseDto> {
    return this.rentals.chargeLateFee(id, dto.alsoCancel ?? false);
  }

  /**
   * POST /admin/rentals/:id/charge-theft-fee
   * Charges the rental's theftFeeCents off-session (one-time replacement fee).
   * Optional body { alsoCancel: true } also cancels the Stripe Subscription.
   * Returns 503 if theftFeeCents = 0, 409 if already charged, 502 if Stripe fails.
   */
  @Post(':id/charge-theft-fee')
  @HttpCode(200)
  async chargeTheftFee(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ChargeLateFeeDto,
  ): Promise<ChargeTheftFeeResponseDto> {
    return this.rentals.chargeTheftFee(id, dto.alsoCancel ?? false);
  }

  /**
   * POST /admin/rentals/:id/cancel
   * Cancels the rental via Stripe (invoice_now: false) and marks DB canceled.
   * Idempotent: already-canceled rentals return 200 without additional Stripe call.
   */
  @Post(':id/cancel')
  @HttpCode(200)
  async cancel(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AdminRentalResponseDto> {
    return this.rentals.cancelAdmin(id);
  }

  /**
   * POST /admin/rentals/:id/retry-setup
   * Re-attempts Stripe Subscription creation for a pending_setup rental.
   * Returns 409 if rental is not in pending_setup status.
   */
  @Post(':id/retry-setup')
  @HttpCode(200)
  async retrySetup(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AdminRentalResponseDto> {
    return this.rentals.retrySetup(id);
  }
}
