import {
  Body,
  Controller,
  Get,
  Put,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../entities/enums';
import { SubscriptionService } from './subscription.service';
import { UpdateSubscriptionPlanDto } from './dto/update-subscription-plan.dto';
import { AdminPlanResponseDto } from './dto/admin-plan-response.dto';
import { DelinquentSubscriptionDto } from './dto/delinquent-subscription.dto';

/**
 * Admin endpoints for subscription plan management.
 * All routes require SUPER_ADMIN_DELIVERY role.
 *
 * Routes:
 *   GET  /admin/subscription/plan       — retrieve current plan (admin view with all fields)
 *   PUT  /admin/subscription/plan       — rotate Stripe price + update DB row
 *   GET  /admin/subscription/delinquent — list past-due rental subscriptions ordered by days delinquent
 */
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN_DELIVERY)
@Controller('admin/subscription')
export class AdminSubscriptionController {
  constructor(private readonly subscription: SubscriptionService) {}

  /**
   * GET /admin/subscription/plan
   * Returns the full AdminPlanResponseDto (includes stripeProductId, activeStripePriceId, etc.)
   * Throws 503 SUBSCRIPTION_PLAN_NOT_CONFIGURED when no plan row exists.
   */
  @Get('plan')
  async getAdminPlan(): Promise<AdminPlanResponseDto> {
    const plan = await this.subscription.getAdminPlan();
    if (!plan) {
      throw new ServiceUnavailableException({
        statusCode: 503,
        code: 'SUBSCRIPTION_PLAN_NOT_CONFIGURED',
        message: 'Subscription plan not configured',
      });
    }
    return plan;
  }

  /**
   * PUT /admin/subscription/plan
   * Rotates the Stripe Price (Stripe-first), then updates the DB row.
   * Body: UpdateSubscriptionPlanDto — all three fields optional (unitAmountCents, purchasePriceCents, lateFeeCents).
   * Returns 200 AdminPlanResponseDto on success.
   * Throws:
   *   400 — DTO validation failure or empty body
   *   502 — Stripe step 1 or 2 failure
   *   503 — no plan row in DB
   *   500 — DB write failure after Stripe success (retry-safe)
   */
  @Put('plan')
  async updatePlan(@Body() dto: UpdateSubscriptionPlanDto): Promise<AdminPlanResponseDto> {
    return this.subscription.updatePlan(dto);
  }

  /**
   * GET /admin/subscription/delinquent
   * Returns rental subscriptions with status past_due/unpaid and current_period_end < NOW(),
   * ordered by days delinquent DESC (oldest first).
   * Returns an empty array when no delinquent subscriptions exist.
   */
  @Get('delinquent')
  async getDelinquentList(): Promise<DelinquentSubscriptionDto[]> {
    return this.subscription.getDelinquentList();
  }
}
