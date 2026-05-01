import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { SubscriptionService } from './subscription.service';

@Controller()
export class SubscriptionController {
  constructor(private readonly subscription: SubscriptionService) {}

  /**
   * GET /subscription/plan — public, no auth guard.
   */
  @Public()
  @Get('subscription/plan')
  getPlan() {
    return this.subscription.getPlan();
  }

  /**
   * GET /me/subscription — returns subscriber's current subscription or null.
   */
  @UseGuards(JwtAuthGuard)
  @Get('me/subscription')
  getMySubscription(@CurrentUser() user: AuthenticatedUser) {
    return this.subscription.getMySubscription(user.id);
  }

  /**
   * POST /subscription/checkout-session — creates a Stripe Checkout session.
   * Body: { successUrl, cancelUrl }
   */
  @UseGuards(JwtAuthGuard)
  @Post('subscription/checkout-session')
  createCheckoutSession(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { successUrl: string; cancelUrl: string },
  ) {
    const successUrl = body.successUrl ?? 'https://app.zaz.com/subscription?session=success';
    const cancelUrl = body.cancelUrl ?? 'https://app.zaz.com/subscription?session=canceled';
    return this.subscription.createCheckoutSession(user.id, successUrl, cancelUrl);
  }

  /**
   * POST /subscription/portal-session — creates a Stripe Customer Portal session.
   */
  @UseGuards(JwtAuthGuard)
  @Post('subscription/portal-session')
  createPortalSession(@CurrentUser() user: AuthenticatedUser) {
    return this.subscription.createPortalSession(user.id);
  }

  /**
   * POST /subscription/cancel — schedules cancellation at period end.
   */
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Post('subscription/cancel')
  async cancelAtPeriodEnd(@CurrentUser() user: AuthenticatedUser) {
    await this.subscription.cancelAtPeriodEnd(user.id);
    return {};
  }

  /**
   * POST /subscription/reactivate — removes cancel_at_period_end flag.
   */
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Post('subscription/reactivate')
  async reactivate(@CurrentUser() user: AuthenticatedUser) {
    await this.subscription.reactivate(user.id);
    return {};
  }
}
