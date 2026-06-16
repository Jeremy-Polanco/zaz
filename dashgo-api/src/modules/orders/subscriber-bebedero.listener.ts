import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Product } from '../../entities';
import { PaymentMethod, UserRole } from '../../entities/enums';
import { OrdersService } from './orders.service';
import { RentalsService } from '../rentals/rentals.service';
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
export class SubscriberBebederoListener {
  private readonly logger = new Logger(SubscriberBebederoListener.name);

  constructor(
    @InjectRepository(Product)
    private readonly products: Repository<Product>,
    private readonly orders: OrdersService,
    private readonly rentals: RentalsService,
  ) {}

  @OnEvent(SUBSCRIPTION_ACTIVATED)
  async handleSubscriptionActivated(
    event: SubscriptionActivatedEvent,
  ): Promise<void> {
    const { userId } = event;

    const bebedero = await this.products.findOne({
      where: { isDefaultSubscriberBebedero: true },
    });
    if (!bebedero) {
      this.logger.warn(
        `No default subscriber bebedero configured — skipping auto-order for user ${userId}`,
      );
      return;
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
      return;
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
    } catch (err) {
      if (err instanceof ConflictException) {
        // RENTAL_ALREADY_ACTIVE race — another path created it concurrently. Fine.
        return;
      }
      this.logger.error(
        `Auto bebedero order failed for user ${userId}: ${(err as Error).message}`,
      );
    }
  }
}
