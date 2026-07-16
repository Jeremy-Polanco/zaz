import {
  ConflictException,
  Injectable,
  Logger,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Product } from '../../entities';
import { PaymentMethod, UserRole } from '../../entities/enums';
import { OrdersService } from './orders.service';
import { RentalsService } from '../rentals/rentals.service';
import { SubscriptionService } from '../subscription/subscription.service';
import {
  SUBSCRIPTION_ACTIVATED,
  SubscriptionActivatedEvent,
} from '../../common/events/subscription.events';

/**
 * Auto-provisions the free bebedero when a user's subscription becomes active.
 *
 * Listens for `subscription.activated` (emitted by SubscriptionService) and
 * creates a $0 order for the product flagged `isDefaultSubscriberBebedero`.
 * Event-driven so SubscriptionService never depends on OrdersService — this is
 * what keeps the module graph acyclic (OrdersModule already imports
 * SubscriptionModule).
 *
 * Idempotent and non-throwing: a missing default product, an existing rental,
 * or the 1-per-product RENTAL_ALREADY_ACTIVE guard all short-circuit quietly so
 * a replayed webhook never creates duplicates or breaks the listener.
 */
@Injectable()
export class SubscriberBebederoListener implements OnApplicationBootstrap {
  private readonly logger = new Logger(SubscriberBebederoListener.name);

  constructor(
    @InjectRepository(Product)
    private readonly products: Repository<Product>,
    private readonly orders: OrdersService,
    private readonly rentals: RentalsService,
    private readonly subscriptions: SubscriptionService,
  ) {}

  /**
   * One-time backfill: provision the default bebedero for every active
   * subscriber who subscribed BEFORE a default bebedero was configured (their
   * subscription.activated event found no flagged product, so nothing was
   * created). Idempotent — provisionForUser skips anyone who already has one —
   * so it is safe to run on every boot. Runs in the background so it never
   * blocks app readiness.
   */
  onApplicationBootstrap(): void {
    void this.backfillMissingBebederos().catch((err) =>
      this.logger.error(
        `bebedero backfill failed: ${(err as Error).message}`,
      ),
    );
  }

  async backfillMissingBebederos(): Promise<{
    created: number;
    skipped: number;
  }> {
    const userIds = await this.subscriptions.listActiveSubscriberUserIds();
    let created = 0;
    let skipped = 0;
    for (const userId of userIds) {
      const result = await this.provisionForUser(userId);
      if (result === 'created') created += 1;
      else skipped += 1;
    }
    if (created > 0) {
      this.logger.log(
        `bebedero backfill: created ${created}, skipped ${skipped} (of ${userIds.length} active subscribers)`,
      );
    }
    return { created, skipped };
  }

  @OnEvent(SUBSCRIPTION_ACTIVATED)
  async handleSubscriptionActivated(
    event: SubscriptionActivatedEvent,
  ): Promise<void> {
    await this.provisionForUser(event.userId);
  }

  /**
   * Hourly reconcile: re-runs the idempotent backfill so a provisioning that
   * was deferred at activation time (e.g. ACTIVE_ORDER_EXISTS because the
   * subscriber had an order in flight when they subscribed) heals within the
   * hour instead of waiting for the next deploy's bootstrap pass.
   */
  @Cron('20 * * * *')
  async reconcileHourly(): Promise<void> {
    await this.backfillMissingBebederos();
  }

  /**
   * Create the $0 default-bebedero order for one subscriber, unless they
   * already have a bebedero rental (idempotent) or no default is configured.
   * Never throws — errors are logged so a single bad user can't abort a backfill.
   */
  private async provisionForUser(
    userId: string,
  ): Promise<'created' | 'skipped' | 'no-default'> {
    const bebedero = await this.products.findOne({
      where: { isDefaultSubscriberBebedero: true },
    });
    if (!bebedero) {
      this.logger.warn(
        `No default subscriber bebedero configured — skipping auto-order for user ${userId}`,
      );
      return 'no-default';
    }

    // Idempotency: skip if the user already holds (or is setting up) this rental.
    const existing = await this.rentals.findActiveByUserAndProduct(
      userId,
      bebedero.id,
    );
    if (existing) {
      this.logger.log(
        `User ${userId} already has a bebedero rental — skipping auto-order`,
      );
      return 'skipped';
    }

    try {
      await this.orders.create(
        { id: userId, role: UserRole.CLIENT, email: null },
        {
          items: [{ productId: bebedero.id, quantity: 1 }],
          paymentMethod: PaymentMethod.CASH,
          usePoints: false,
          useCredit: false,
        },
      );
      this.logger.log(
        `Auto-created free bebedero order for subscriber ${userId}`,
      );
      return 'created';
    } catch (err) {
      if (err instanceof ConflictException) {
        const response = err.getResponse();
        const code =
          typeof response === 'object' && response !== null
            ? (response as { code?: string }).code
            : undefined;
        if (code === 'RENTAL_ALREADY_ACTIVE') {
          // Race — another path created the rental concurrently. Fine.
          this.logger.log(
            `User ${userId} bebedero rental appeared concurrently — skipping`,
          );
          return 'skipped';
        }
        // Any OTHER business conflict is NOT equivalent to "already provisioned".
        // ACTIVE_ORDER_EXISTS (subscriber had an order in flight when they
        // subscribed) used to be swallowed here silently, losing the bebedero
        // until the next deploy. Log it and let the hourly reconcile retry.
        this.logger.warn(
          `Auto bebedero order deferred for user ${userId}: ${code ?? 'CONFLICT'} — hourly reconcile will retry`,
        );
        return 'skipped';
      }
      this.logger.error(
        `Auto bebedero order failed for user ${userId}: ${(err as Error).message}`,
      );
      return 'skipped';
    }
  }
}
