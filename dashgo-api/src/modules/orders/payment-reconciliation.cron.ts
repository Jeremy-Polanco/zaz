import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, MoreThan, Not, Repository } from 'typeorm';
import { Order } from '../../entities';
import { OrderStatus, PaymentMethod } from '../../entities/enums';
import { PaymentsService } from '../payments/payments.service';
import { OrdersService } from './orders.service';

/**
 * Safety net for lost Stripe webhooks.
 *
 * A digital order leaves QUOTED only when `payment_intent.amount_capturable_updated`
 * reaches us. When Stripe never delivers it (the endpoint gets auto-disabled
 * after days of failed deliveries — e.g. the app sat archived — or a delivery
 * is simply lost), the customer's card holds the money while the admin panel
 * shows "esperando al cliente" forever.
 *
 * Instead of trusting the webhook alone, ask Stripe directly for every stuck
 * order and converge:
 *   requires_capture / succeeded → authorized (+ skip-quote auto-confirm)
 *   canceled                     → back to QUOTED with the intent cleared
 *   anything else                → customer hasn't finished paying; leave it
 *
 * Runs shortly after boot (so a redeploy heals the backlog by itself) and
 * every 5 minutes. Also re-enables our webhook endpoint if Stripe disabled it.
 */
const BOOT_DELAY_MS = 15_000;
const LOOKBACK_DAYS = 14; // card holds expire in ~7 days; keep a safe margin
const BATCH = 50;

@Injectable()
export class PaymentReconciliationCron implements OnApplicationBootstrap {
  private readonly logger = new Logger(PaymentReconciliationCron.name);

  constructor(
    @InjectRepository(Order) private readonly orders: Repository<Order>,
    private readonly payments: PaymentsService,
    private readonly ordersService: OrdersService,
  ) {}

  onApplicationBootstrap() {
    // Off the boot path: let the app finish wiring, then heal the backlog.
    const timer = setTimeout(() => void this.runBootHeal(), BOOT_DELAY_MS);
    timer.unref?.();
  }

  async runBootHeal(): Promise<void> {
    try {
      const { checked, reenabled } =
        await this.payments.ensureWebhookEndpointEnabled();
      this.logger.log(
        `webhook endpoint check: ${checked} ours, ${reenabled} re-enabled`,
      );
    } catch (err) {
      this.logger.warn(
        `webhook endpoint check failed: ${(err as Error).message}`,
      );
    }
    try {
      await this.reconcileStuckDigitalOrders();
    } catch (err) {
      this.logger.error(
        `boot reconciliation failed: ${(err as Error).message}`,
      );
    }
  }

  @Cron(CronExpression.EVERY_5_MINUTES)
  async runEvery5Minutes(): Promise<void> {
    try {
      await this.reconcileStuckDigitalOrders();
    } catch (err) {
      this.logger.error(`reconciliation failed: ${(err as Error).message}`);
    }
  }

  async reconcileStuckDigitalOrders(): Promise<{
    scanned: number;
    authorized: number;
    released: number;
    holdsReleased: number;
  }> {
    const result = { scanned: 0, authorized: 0, released: 0, holdsReleased: 0 };
    if (!this.payments.isEnabled()) return result;

    const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
    const stuck = await this.orders.find({
      where: {
        status: OrderStatus.QUOTED,
        paymentMethod: PaymentMethod.DIGITAL,
        stripePaymentIntentId: Not(IsNull()),
        createdAt: MoreThan(since),
      },
      order: { createdAt: 'ASC' },
      take: BATCH,
    });

    for (const order of stuck) {
      result.scanned += 1;
      const intentId = order.stripePaymentIntentId!;
      let status: string;
      try {
        status = (await this.payments.retrieveIntent(intentId)).status;
      } catch (err) {
        this.logger.warn(
          `order ${order.id}: could not read intent ${intentId} — ${(err as Error).message}`,
        );
        continue;
      }
      // Always visible: this is the line you grep when a customer says "me
      // descontaron" and the panel says "esperando al cliente".
      this.logger.log(
        `order ${order.id} (quoted, ${order.totalAmount}): intent ${intentId} is ${status}`,
      );

      if (status === 'requires_capture' || status === 'succeeded') {
        this.logger.warn(
          `order ${order.id}: intent ${intentId} is ${status} but the webhook never arrived — advancing`,
        );
        await this.payments.markAuthorizedByIntentId(intentId);
        if (status === 'succeeded') {
          await this.payments.markPaidByIntentId(intentId);
        }
        await this.ordersService.autoConfirmSkipQuoteByIntentId(intentId);
        result.authorized += 1;
      } else if (status === 'canceled') {
        this.logger.warn(
          `order ${order.id}: intent ${intentId} was canceled at Stripe — releasing the order for retry`,
        );
        await this.payments.handleAuthFailureByIntentId(intentId);
        result.released += 1;
      }
      // requires_payment_method / requires_confirmation / requires_action /
      // processing: the customer is mid-checkout or abandoned — nothing to do.
    }

    // Orphaned holds: orders cancelled (before cancellation released the
    // intent) whose card is still authorized. Release them so the customer's
    // bank frees the money now instead of when the authorization expires.
    const cancelled = await this.orders.find({
      where: {
        status: OrderStatus.CANCELLED,
        paymentMethod: PaymentMethod.DIGITAL,
        stripePaymentIntentId: Not(IsNull()),
        paidAt: IsNull(),
        createdAt: MoreThan(since),
      },
      order: { createdAt: 'ASC' },
      take: BATCH,
    });
    for (const order of cancelled) {
      const intentId = order.stripePaymentIntentId!;
      let status: string;
      try {
        status = (await this.payments.retrieveIntent(intentId)).status;
      } catch (err) {
        this.logger.warn(
          `cancelled order ${order.id}: could not read intent ${intentId} — ${(err as Error).message}`,
        );
        continue;
      }
      if (status !== 'requires_capture') continue;
      this.logger.warn(
        `cancelled order ${order.id} (${order.totalAmount}) still holds intent ${intentId} — releasing the hold`,
      );
      if (await this.payments.cancelIntent(intentId)) {
        result.holdsReleased += 1;
      }
    }

    if (result.scanned || cancelled.length) {
      this.logger.log(
        `reconciled digital orders: ${JSON.stringify(result)} (cancelled scanned: ${cancelled.length})`,
      );
    }
    return result;
  }
}
