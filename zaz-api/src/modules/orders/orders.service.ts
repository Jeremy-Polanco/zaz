import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, FindOptionsWhere, In, Repository } from 'typeorm';
import { Order, OrderItem, Product } from '../../entities';
import { OrderStatus, PaymentMethod, UserRole } from '../../entities/enums';
import { AuthenticatedUser } from '../../common/types/authenticated-user';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { PaymentsService } from '../payments/payments.service';
import { PointsService } from '../points/points.service';
import { InvoicesService } from '../invoices/invoices.service';
import { PromotersService } from '../promoters/promoters.service';
import { ShippingService } from '../shipping/shipping.service';
import { CreditService } from '../credit/credit.service';
import { SubscriptionService } from '../subscription/subscription.service';
import { getEffectivePrice } from '../products/pricing';

const ALLOWED_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  [OrderStatus.PENDING_QUOTE]: [OrderStatus.QUOTED, OrderStatus.CANCELLED],
  [OrderStatus.QUOTED]: [OrderStatus.PENDING_VALIDATION, OrderStatus.CANCELLED],
  [OrderStatus.PENDING_VALIDATION]: [
    OrderStatus.CONFIRMED_BY_COLMADO,
    OrderStatus.CANCELLED,
  ],
  [OrderStatus.CONFIRMED_BY_COLMADO]: [
    OrderStatus.IN_DELIVERY_ROUTE,
    OrderStatus.CANCELLED,
  ],
  [OrderStatus.IN_DELIVERY_ROUTE]: [OrderStatus.DELIVERED, OrderStatus.CANCELLED],
  [OrderStatus.DELIVERED]: [],
  [OrderStatus.CANCELLED]: [],
};

export const TAX_RATE = 0.08887;

@Injectable()
export class OrdersService {
  constructor(
    @InjectRepository(Order) private readonly orders: Repository<Order>,
    @InjectRepository(OrderItem) private readonly items: Repository<OrderItem>,
    @InjectRepository(Product) private readonly products: Repository<Product>,
    private readonly dataSource: DataSource,
    private readonly payments: PaymentsService,
    private readonly points: PointsService,
    private readonly invoices: InvoicesService,
    private readonly promotersService: PromotersService,
    private readonly shipping: ShippingService,
    private readonly credit: CreditService,
    private readonly subscriptionService: SubscriptionService,
  ) {}

  private buildScope(user: AuthenticatedUser): FindOptionsWhere<Order> {
    switch (user.role) {
      case UserRole.SUPER_ADMIN_DELIVERY:
        return {};
      case UserRole.CLIENT:
      default:
        return { customerId: user.id };
    }
  }

  async findAll(user: AuthenticatedUser) {
    return this.orders.find({
      where: this.buildScope(user),
      relations: ['customer', 'items', 'items.product'],
      order: { createdAt: 'DESC' },
    });
  }

  async findOne(id: string, user: AuthenticatedUser) {
    const order = await this.orders.findOne({
      where: { id, ...this.buildScope(user) },
      relations: ['customer', 'items', 'items.product'],
    });
    if (!order) throw new NotFoundException('Pedido no encontrado o sin acceso');
    return order;
  }

  async create(user: AuthenticatedUser, dto: CreateOrderDto) {
    if (user.role !== UserRole.CLIENT && user.role !== UserRole.PROMOTER) {
      throw new ForbiddenException('Solo clientes pueden crear pedidos');
    }

    // T4.2: Global overdue gate — runs BEFORE any products fetch or TX
    await this.credit.assertNotOverdue(user.id);

    const productIds = dto.items.map((i) => i.productId);
    const products = await this.products.find({
      where: { id: In(productIds) },
    });
    const byId = new Map(products.map((p) => [p.id, p]));

    for (const input of dto.items) {
      const product = byId.get(input.productId);
      if (!product) {
        throw new BadRequestException('Uno o más productos no existen');
      }
      if (!product.isAvailable) {
        throw new BadRequestException(
          `El producto "${product.name}" no está disponible`,
        );
      }
      if (product.stock < input.quantity) {
        throw new BadRequestException(
          `Stock insuficiente para "${product.name}" (disponible: ${product.stock})`,
        );
      }
    }

    const now = new Date();
    let subtotalCents = 0;
    const builtItems = dto.items.map((input) => {
      const product = byId.get(input.productId)!;
      const effective = getEffectivePrice(product, now);
      const lineCents = effective.priceCents * input.quantity;
      subtotalCents += lineCents;
      const priceAtOrder = (effective.priceCents / 100).toFixed(2);
      return {
        productId: input.productId,
        quantity: input.quantity,
        priceAtOrder,
      };
    });

    const saved = await this.dataSource.transaction(async (tx) => {
      const orderRepo = tx.getRepository(Order);
      const itemRepo = tx.getRepository(OrderItem);

      let pointsRedeemedCents = 0;
      if (dto.usePoints) {
        const balance = await this.points.getBalance(user.id);
        if (balance.claimableCents > 0) {
          pointsRedeemedCents = Math.min(balance.claimableCents, subtotalCents);
        }
      }

      // T4.3: Acquire pessimistic lock on credit_account EARLY in the TX
      // (before order/items are written), to avoid deadlock ordering issues.
      let creditAppliedCents = 0;
      if (dto.useCredit && user.role === UserRole.CLIENT) {
        // getAccountWithLock will throw if no account exists; create first if needed
        const creditAccount = await (async () => {
          try {
            return await this.credit.getAccountWithLock(user.id, tx);
          } catch {
            // No account yet — skip credit for this order silently
            return null;
          }
        })();

        if (creditAccount) {
          const available =
            creditAccount.balanceCents + creditAccount.creditLimitCents;
          if (available > 0) {
            creditAppliedCents = Math.min(available, subtotalCents);
          }
        }
      }
      // Silently skip useCredit for PROMOTER / SUPER_ADMIN_DELIVERY (no error)

      // Shipping is quoted manually by the super admin AFTER the order is
      // placed. We start with shipping=0 / tax=0 / total=(subtotal - points).
      // The admin will transition PENDING_QUOTE → QUOTED via setQuote().
      const taxableCents = Math.max(0, subtotalCents - pointsRedeemedCents);
      const totalCents = taxableCents; // tax = 0 until quoted

      const order = orderRepo.create({
        customerId: user.id,
        status: OrderStatus.PENDING_QUOTE,
        deliveryAddress: dto.deliveryAddress,
        subtotal: (subtotalCents / 100).toFixed(2),
        pointsRedeemed: (pointsRedeemedCents / 100).toFixed(2),
        shipping: '0.00',
        tax: '0.00',
        taxRate: TAX_RATE.toFixed(5),
        totalAmount: (totalCents / 100).toFixed(2),
        paymentMethod: dto.paymentMethod,
        stripePaymentIntentId: null,
        paidAt: null,
        creditApplied: '0.00',
      });

      const persisted = await orderRepo.save(order);

      for (const it of builtItems) {
        await itemRepo.save(
          itemRepo.create({
            orderId: persisted.id,
            productId: it.productId,
            quantity: it.quantity,
            priceAtOrder: it.priceAtOrder,
          }),
        );
      }

      // T4.3 (continued): Apply credit charge AFTER order+items persisted, BEFORE points
      if (creditAppliedCents > 0) {
        await this.credit.applyCharge(
          { userId: user.id, orderId: persisted.id, amountCents: creditAppliedCents },
          tx,
        );
        await orderRepo.update(persisted.id, {
          creditApplied: (creditAppliedCents / 100).toFixed(2),
        });
        // Reflect in the persisted object so caller can check full-credit
        persisted.creditApplied = (creditAppliedCents / 100).toFixed(2);
      }

      if (pointsRedeemedCents > 0) {
        await this.points.redeemAllClaimable(user.id, persisted.id, tx);
      }

      return persisted;
    });

    return this.findOne(saved.id, user);
  }

  /**
   * Super admin sets the manually-quoted shipping amount for an order.
   * Recomputes tax and total on the backend (source of truth). Idempotent
   * when the amount is unchanged.
   */
  async setQuote(
    id: string,
    shippingCents: number,
    user: AuthenticatedUser,
  ) {
    if (user.role !== UserRole.SUPER_ADMIN_DELIVERY) {
      throw new ForbiddenException('Solo el super admin puede cotizar pedidos');
    }
    if (!Number.isInteger(shippingCents) || shippingCents < 0) {
      throw new BadRequestException('shippingCents inválido');
    }

    const order = await this.findOne(id, user);

    if (
      order.status !== OrderStatus.PENDING_QUOTE &&
      order.status !== OrderStatus.QUOTED
    ) {
      throw new BadRequestException(
        `No se puede cotizar un pedido en estado ${order.status}`,
      );
    }

    // Subscriber override: if customer has an active subscription, shipping is free
    const isSub = await this.subscriptionService.isActiveSubscriber(order.customerId);
    if (isSub) {
      shippingCents = 0;
    }
    Logger.debug(
      `order ${id} subscriber: ${isSub}, shipping=${shippingCents}`,
      OrdersService.name,
    );

    const subtotalCents = Math.round(parseFloat(order.subtotal) * 100);
    const pointsRedeemedCents = Math.round(
      parseFloat(order.pointsRedeemed) * 100,
    );
    const taxableCents = Math.max(
      0,
      subtotalCents + shippingCents - pointsRedeemedCents,
    );
    const taxCents = Math.round(taxableCents * TAX_RATE);
    const totalCents = taxableCents + taxCents;

    await this.orders.update(id, {
      shipping: (shippingCents / 100).toFixed(2),
      tax: (taxCents / 100).toFixed(2),
      totalAmount: (totalCents / 100).toFixed(2),
      status: OrderStatus.QUOTED,
      quotedAt: order.quotedAt ?? new Date(),
      wasSubscriberAtQuote: isSub,
    });

    return this.findOne(id, user);
  }

  /**
   * Customer authorizes payment for a quoted digital order. Creates a Stripe
   * PaymentIntent with capture_method='manual' for the quoted total. The order
   * transitions to PENDING_VALIDATION only when the webhook confirms the
   * authorization (payment_intent.amount_capturable_updated).
   */
  async authorize(id: string, user: AuthenticatedUser) {
    const order = await this.findOne(id, user);

    if (order.customerId !== user.id) {
      throw new ForbiddenException('No sos el dueño de este pedido');
    }
    if (order.status !== OrderStatus.QUOTED) {
      throw new BadRequestException(
        `No se puede autorizar un pedido en estado ${order.status}`,
      );
    }
    if (order.paymentMethod !== PaymentMethod.DIGITAL) {
      throw new BadRequestException('Este pedido es en efectivo');
    }

    // Idempotency: if we already have an active intent, return its client secret
    if (order.stripePaymentIntentId) {
      const existing = await this.payments.retrieveIntent(
        order.stripePaymentIntentId,
      );
      if (
        existing.status !== 'canceled' &&
        existing.status !== 'succeeded'
      ) {
        return {
          paymentIntentId: existing.id,
          clientSecret: existing.client_secret ?? '',
          amount: existing.amount,
          currency: existing.currency,
        };
      }
    }

    // CRIT-1 fix: subtract credit already applied to this order so we don't
    // double-charge the customer (Stripe + credit). totalAmount stays as the
    // full gross total of the order; the Stripe portion is the residue after
    // credit covers part of it.
    const totalCents = Math.round(parseFloat(order.totalAmount) * 100);
    const creditAppliedCents = Math.round(
      parseFloat(order.creditApplied || '0') * 100,
    );
    const stripeAmountCents = totalCents - creditAppliedCents;
    if (stripeAmountCents <= 0) {
      // Fully (or over-) covered by credit — must use the non-Stripe path.
      throw new BadRequestException(
        'Este pedido está cubierto por crédito — usá /confirm-non-stripe',
      );
    }

    const created = await this.payments.createAuthorizationIntent({
      userId: user.id,
      orderId: order.id,
      amountCents: stripeAmountCents,
    });

    await this.orders.update(id, {
      stripePaymentIntentId: created.paymentIntentId,
    });

    return created;
  }

  /**
   * Customer confirms a non-Stripe order after the admin has quoted it.
   * Moves the order from QUOTED → PENDING_VALIDATION.
   *
   * Handles two cases:
   *   1. Cash orders (paymentMethod === CASH)
   *   2. Full-credit orders (stripePaymentIntentId === null, credit covers total)
   *
   * Rejects orders that require Stripe authorization (digital + intentId present).
   */
  async confirmNonStripeOrder(id: string, user: AuthenticatedUser) {
    const order = await this.findOne(id, user);

    if (order.customerId !== user.id) {
      throw new ForbiddenException('No sos el dueño de este pedido');
    }
    if (order.status !== OrderStatus.QUOTED) {
      throw new BadRequestException(
        `No se puede confirmar un pedido en estado ${order.status}`,
      );
    }
    // Reject if an active Stripe intent exists — client should use /authorize instead
    if (order.stripePaymentIntentId !== null) {
      throw new BadRequestException(
        'Este pedido tiene un pago digital pendiente — usá /authorize',
      );
    }

    await this.orders.update(id, { status: OrderStatus.PENDING_VALIDATION });
    return this.findOne(id, user);
  }

  /**
   * Backward-compatible alias kept so existing clients don't break.
   * @deprecated Use confirmNonStripeOrder instead.
   */
  async confirmCashOrder(id: string, user: AuthenticatedUser) {
    return this.confirmNonStripeOrder(id, user);
  }


  async updateStatus(
    id: string,
    dto: UpdateOrderStatusDto,
    user: AuthenticatedUser,
  ) {
    const order = await this.findOne(id, user);

    const allowed = ALLOWED_TRANSITIONS[order.status];
    if (!allowed.includes(dto.status)) {
      throw new BadRequestException(
        `Transición inválida: ${order.status} → ${dto.status}`,
      );
    }

    this.assertCanTransition(order.status, dto.status, user);

    const isConfirming =
      order.status === OrderStatus.PENDING_VALIDATION &&
      dto.status === OrderStatus.CONFIRMED_BY_COLMADO;

    const isDelivering =
      order.status === OrderStatus.IN_DELIVERY_ROUTE &&
      dto.status === OrderStatus.DELIVERED;

    if (isConfirming) {
      await this.confirmAndDecrementStock(order.id);
    } else if (isDelivering) {
      await this.markDelivered(order.id);
    } else if (dto.status === OrderStatus.CANCELLED) {
      // T4.4: Wrap cancel transition in a TX so credit reversal is atomic
      await this.dataSource.transaction(async (cancelTx) => {
        await cancelTx.getRepository(Order).update(id, { status: OrderStatus.CANCELLED });
        if (parseFloat(order.creditApplied || '0') > 0) {
          await this.credit.reverseCharge(order.id, cancelTx);
        }
      });
    } else {
      await this.orders.update(id, { status: dto.status });
    }

    return this.findOne(id, user);
  }

  private async markDelivered(orderId: string) {
    await this.dataSource.transaction(async (tx) => {
      const orderRepo = tx.getRepository(Order);

      // Fetch with a write lock so we can safely decide whether to capture.
      const order = await orderRepo.findOne({
        where: { id: orderId },
        loadEagerRelations: false,
        lock: { mode: 'pessimistic_write' },
      });
      if (!order) throw new NotFoundException('Pedido no encontrado');

      // Capture the Stripe authorization for digital orders that haven't been
      // paid yet. If capture fails the transaction aborts — order stays in
      // IN_DELIVERY_ROUTE so ops can investigate.
      if (
        order.paymentMethod === PaymentMethod.DIGITAL &&
        order.stripePaymentIntentId &&
        order.paidAt === null
      ) {
        await this.payments.captureIntent(order.stripePaymentIntentId);
        const now = new Date();
        await orderRepo.update(orderId, {
          status: OrderStatus.DELIVERED,
          paidAt: now,
          capturedAt: now,
        });
      } else {
        await orderRepo.update(orderId, { status: OrderStatus.DELIVERED });
      }

      await this.points.creditForOrder(orderId, tx);
      await this.invoices.createForOrder(orderId, tx);
      await this.promotersService.creditCommissionsForOrder(orderId, tx);
    });
  }

  private async confirmAndDecrementStock(orderId: string) {
    await this.dataSource.transaction(async (tx) => {
      const orderRepo = tx.getRepository(Order);
      const itemRepo = tx.getRepository(OrderItem);
      const productRepo = tx.getRepository(Product);

      const order = await orderRepo.findOne({
        where: { id: orderId },
        loadEagerRelations: false,
        lock: { mode: 'pessimistic_write' },
      });
      if (!order) throw new NotFoundException('Pedido no encontrado');
      if (order.status !== OrderStatus.PENDING_VALIDATION) {
        throw new BadRequestException(
          'La orden ya no está pendiente de validación',
        );
      }

      const items = await itemRepo.find({ where: { orderId } });

      for (const item of items) {
        const product = await productRepo.findOne({
          where: { id: item.productId },
          lock: { mode: 'pessimistic_write' },
        });
        if (!product) continue;

        if (product.stock < item.quantity) {
          throw new BadRequestException(
            `Stock insuficiente para el producto ${product.name} al confirmar`,
          );
        }
        const nextStock = product.stock - item.quantity;
        await productRepo.update(product.id, {
          stock: nextStock,
          isAvailable: nextStock > 0 ? product.isAvailable : false,
        });
      }

      await orderRepo.update(orderId, {
        status: OrderStatus.CONFIRMED_BY_COLMADO,
      });
    });
  }

  private assertCanTransition(
    from: OrderStatus,
    to: OrderStatus,
    user: AuthenticatedUser,
  ) {
    if (user.role === UserRole.SUPER_ADMIN_DELIVERY) return;

    if (user.role === UserRole.CLIENT || user.role === UserRole.PROMOTER) {
      const clientCancellable = [
        OrderStatus.PENDING_QUOTE,
        OrderStatus.QUOTED,
        OrderStatus.PENDING_VALIDATION,
      ];
      if (clientCancellable.includes(from) && to === OrderStatus.CANCELLED) {
        return;
      }
      throw new ForbiddenException('Cliente no puede ejecutar esta transición');
    }
  }
}
