import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Product } from '../../entities';
import { SubscriptionTier } from '../../entities/subscription-plan.entity';
import { PaymentMethod, UserRole } from '../../entities/enums';
import { OrdersService } from './orders.service';
import { RentalsService } from '../rentals/rentals.service';
import { SubscriptionService } from '../subscription/subscription.service';
import {
  SUBSCRIPTION_ACTIVATED,
  SubscriptionActivatedEvent,
} from '../../common/events/subscription.events';

/**
 * Provisiona el producto alquilado exclusivo del plan PREMIUM cuando una
 * suscripción premium se activa.
 *
 * Hermano de `SubscriberBebederoListener` y con la misma disciplina
 * (idempotente, no tira, con reconcile horario), pero con dos diferencias:
 *
 *  - Solo corre para tier premium. Un suscriptor standard no recibe nada acá.
 *  - La orden de instalación se lleva hasta ENTREGADA. Sin eso el alquiler
 *    queda en `pending_setup` y el contador de mantenimiento nunca arranca:
 *    el producto figuraría entregado en la calle y sin mantenimiento agendado.
 */
@Injectable()
export class PremiumProductListener {
  private readonly logger = new Logger(PremiumProductListener.name);

  constructor(
    @InjectRepository(Product)
    private readonly products: Repository<Product>,
    private readonly orders: OrdersService,
    private readonly rentals: RentalsService,
    private readonly subscriptions: SubscriptionService,
  ) {}

  @OnEvent(SUBSCRIPTION_ACTIVATED)
  async handleSubscriptionActivated(
    event: SubscriptionActivatedEvent,
  ): Promise<void> {
    // El evento trae el tier. Si viniera sin él (emisor viejo), se consulta —
    // nunca se asume premium: regalar un producto caro por defecto es el error
    // que nadie reporta.
    const tier =
      event.tier ?? (await this.subscriptions.getActiveTier(event.userId));
    if (tier !== SubscriptionTier.PREMIUM) return;
    await this.provisionForUser(event.userId);
  }

  /**
   * Reconcile horario: una provisión diferida (por ejemplo ACTIVE_ORDER_EXISTS
   * porque el usuario tenía un pedido en curso al suscribirse) se cura dentro
   * de la hora en vez de esperar al próximo deploy.
   */
  @Cron('35 * * * *')
  async reconcileHourly(): Promise<void> {
    const userIds = await this.subscriptions.listActiveSubscriberUserIds();
    for (const userId of userIds) {
      const tier = await this.subscriptions.getActiveTier(userId);
      if (tier !== SubscriptionTier.PREMIUM) continue;
      await this.provisionForUser(userId);
    }
  }

  /**
   * Crea la orden de instalación del producto premium y la lleva a entregada.
   * Nunca tira: un usuario con problema no puede abortar el reconcile de todos.
   */
  async provisionForUser(
    userId: string,
  ): Promise<'created' | 'skipped' | 'no-product'> {
    const product = await this.products.findOne({
      where: { isPremiumSubscriberProduct: true },
    });
    if (!product) {
      this.logger.warn(
        `No hay producto premium configurado — se omite la instalación para ${userId}`,
      );
      return 'no-product';
    }

    // Idempotencia: si ya lo tiene (o lo está instalando), no se crea otra.
    const existing = await this.rentals.findActiveByUserAndProduct(
      userId,
      product.id,
    );
    if (existing) return 'skipped';

    try {
      const order = await this.orders.create(
        { id: userId, role: UserRole.CLIENT, email: null },
        {
          items: [{ productId: product.id, quantity: 1 }],
          paymentMethod: PaymentMethod.CASH,
          usePoints: false,
          useCredit: false,
        },
      );

      // Se entrega en el acto: es lo que activa el alquiler y arranca el
      // mantenimiento. Si no se pudo, el reconcile horario reintenta.
      const delivered = await this.orders.deliverProvisionedOrder(order.id);
      this.logger.log(
        `Instalación premium para ${userId}: orden ${order.id}${
          delivered ? ' entregada' : ' creada (entrega pendiente)'
        }`,
      );
      return 'created';
    } catch (err) {
      if (err instanceof ConflictException) {
        const response = err.getResponse();
        const code =
          typeof response === 'object' && response !== null
            ? (response as { code?: string }).code
            : undefined;
        this.logger.warn(
          `Instalación premium diferida para ${userId}: ${code ?? 'CONFLICT'} — reintenta el reconcile horario`,
        );
        return 'skipped';
      }
      this.logger.error(
        `Instalación premium falló para ${userId}: ${(err as Error).message}`,
      );
      return 'skipped';
    }
  }
}
