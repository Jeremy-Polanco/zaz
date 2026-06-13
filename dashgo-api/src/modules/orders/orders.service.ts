import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as Sentry from '@sentry/node';
import { DataSource, FindOptionsWhere, In, Not, Repository } from 'typeorm';
import { Order, OrderItem, Product } from '../../entities';
import { OrderStatus, PaymentMethod, UserRole } from '../../entities/enums';
import { AuthenticatedUser } from '../../common/types/authenticated-user';
import { CreateOrderDto, DeliveryAddressDto } from './dto/create-order.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { PaymentsService } from '../payments/payments.service';
import { PointsService } from '../points/points.service';
import { InvoicesService } from '../invoices/invoices.service';
import { PromotersService } from '../promoters/promoters.service';
import { ShippingService } from '../shipping/shipping.service';
import { CreditService } from '../credit/credit.service';
import { SubscriptionService } from '../subscription/subscription.service';
import { TwilioService } from '../twilio/twilio.service';
import { RentalsService } from '../rentals/rentals.service';
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
  private readonly logger = new Logger(OrdersService.name);

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
    private readonly twilio: TwilioService,
    private readonly rentalsService: RentalsService,
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

    // One active order at a time (clients only): block a new order while the
    // customer still has one in progress (anything not delivered/cancelled).
    // Stops the duplicate/repeated orders the colmado was seeing.
    if (user.role === UserRole.CLIENT) {
      const activeCount = await this.orders.count({
        where: {
          customerId: user.id,
          status: Not(In([OrderStatus.DELIVERED, OrderStatus.CANCELLED])),
        },
      });
      if (activeCount > 0) {
        throw new ConflictException({
          code: 'ACTIVE_ORDER_EXISTS',
          message:
            'Ya tenés un pedido en curso. Esperá a que se complete antes de hacer otro.',
        });
      }
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

    // T6.4: Mixed-cart guard — reject orders that mix rental + single_payment items.
    // Server-side enforcement mirrors mobile validation (T6.1/T9.3).
    // Must run BEFORE TX to avoid partial writes.
    const hasRental = dto.items.some(
      (input) => byId.get(input.productId)?.pricingMode === 'rental',
    );
    const hasSinglePayment = dto.items.some(
      (input) => byId.get(input.productId)?.pricingMode !== 'rental',
    );
    if (hasRental && hasSinglePayment) {
      throw new BadRequestException({
        code: 'MIXED_CART_NOT_ALLOWED',
        message:
          'No podés combinar productos de alquiler con productos de compra única en el mismo pedido.',
      });
    }

    // T63: Pre-check — for each rental item, ensure no active rental already exists.
    // This runs BEFORE TX (outside any transaction) per the design spec.
    for (const input of dto.items) {
      const product = byId.get(input.productId)!;
      if (product.pricingMode === 'rental') {
        const existing = await this.rentalsService.findActiveByUserAndProduct(user.id, product.id);
        if (existing) {
          throw new ConflictException({
            code: 'RENTAL_ALREADY_ACTIVE',
            message: `Ya tenés un alquiler activo de "${product.name}". Cancelá el actual antes de pedir otro.`,
          });
        }
      }
    }

    // Skip-cotización: an order whose items are ALL flagged requiresQuote=false
    // (e.g. water — standardized bulk delivery) is auto-quoted at creation (see
    // the TX below). If ANY item requires a quote, the order goes through the
    // normal manual cotización flow (PENDING_QUOTE → setQuote → QUOTED).
    const skipQuote =
      dto.items.length > 0 &&
      dto.items.every(
        (input) => byId.get(input.productId)?.requiresQuote === false,
      );

    const now = new Date();
    let subtotalCents = 0;
    const builtItems = dto.items.map((input) => {
      const product = byId.get(input.productId)!;
      let lineCents: number;
      let priceAtOrder: string;

      if (product.pricingMode === 'rental') {
        // T58: For rental items, use monthlyRentCents (first month's payment)
        lineCents = product.monthlyRentCents * input.quantity;
        priceAtOrder = (product.monthlyRentCents / 100).toFixed(2);
      } else {
        const effective = getEffectivePrice(product, now);
        lineCents = effective.priceCents * input.quantity;
        priceAtOrder = (effective.priceCents / 100).toFixed(2);
      }

      subtotalCents += lineCents;
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

      // Cotización. By default, shipping is quoted manually by the super admin
      // AFTER the order is placed: we start with shipping=0 / tax=0 /
      // total=(subtotal - points) and the admin transitions PENDING_QUOTE →
      // QUOTED via setQuote().
      //
      // When `skipQuote` is true (every item has requiresQuote=false), the
      // order skips that step entirely: shipping stays $0 (included), we compute
      // tax now — exactly as setQuote would — and land the order directly in
      // QUOTED so the customer can pay immediately.
      const taxableCents = Math.max(0, subtotalCents - pointsRedeemedCents);
      const taxCents = skipQuote ? Math.round(taxableCents * TAX_RATE) : 0;
      const totalCents = taxableCents + taxCents;

      const order = orderRepo.create({
        customerId: user.id,
        status: skipQuote ? OrderStatus.QUOTED : OrderStatus.PENDING_QUOTE,
        // Customers no longer send an address — the super-admin sets it at
        // delivery time. Persist null when absent.
        deliveryAddress: dto.deliveryAddress ?? null,
        subtotal: (subtotalCents / 100).toFixed(2),
        pointsRedeemed: (pointsRedeemedCents / 100).toFixed(2),
        shipping: '0.00',
        tax: (taxCents / 100).toFixed(2),
        taxRate: TAX_RATE.toFixed(5),
        totalAmount: (totalCents / 100).toFixed(2),
        quotedAt: skipQuote ? now : null,
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

      // T3.3 (REQ-2): Create Rental rows inside the same TX for all rental-mode items.
      // This guarantees a Rental row exists at PENDING_SETUP before the order is committed,
      // so activateRentalsForOrder at delivery time always finds the row.
      for (const input of dto.items) {
        const product = byId.get(input.productId)!;
        if (product.pricingMode === 'rental') {
          await this.rentalsService.createForOrder(
            {
              userId: user.id,
              productId: product.id,
              orderId: persisted.id,
              product,
            },
            tx,
          );
        }
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

    const order = await this.findOne(saved.id, user);

    // Fire-and-forget SMS notification — never block the HTTP response on Twilio.
    void this.twilio
      .sendOrderNotificationSms(order)
      .catch((err) =>
        this.logger.error(
          `Order SMS notification failed for order ${order.id}: ${(err as Error).message}`,
        ),
      );

    return order;
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

    // Active subscribers get free shipping — override the admin-quoted amount.
    const isSub = await this.subscriptionService.isActiveSubscriber(order.customerId);
    let effectiveShippingCents = shippingCents;
    if (isSub) {
      effectiveShippingCents = 0;
    }

    const subtotalCents = Math.round(parseFloat(order.subtotal) * 100);
    const pointsRedeemedCents = Math.round(
      parseFloat(order.pointsRedeemed) * 100,
    );
    const taxableCents = Math.max(
      0,
      subtotalCents + effectiveShippingCents - pointsRedeemedCents,
    );
    const taxCents = Math.round(taxableCents * TAX_RATE);
    const totalCents = taxableCents + taxCents;

    await this.orders.update(id, {
      shipping: (effectiveShippingCents / 100).toFixed(2),
      tax: (taxCents / 100).toFixed(2),
      totalAmount: (totalCents / 100).toFixed(2),
      status: OrderStatus.QUOTED,
      quotedAt: order.quotedAt ?? new Date(),
      wasSubscriberAtQuote: isSub,
    });

    return this.findOne(id, user);
  }

  /**
   * Super-admin sets/updates an order's delivery address. Used at delivery
   * time: the colmado captures the customer's GPS on arrival and pins the
   * exact destination. Customers never send an address themselves.
   */
  async setDeliveryAddress(
    id: string,
    address: DeliveryAddressDto,
    user: AuthenticatedUser,
  ) {
    if (user.role !== UserRole.SUPER_ADMIN_DELIVERY) {
      throw new ForbiddenException(
        'Solo el super admin puede fijar la dirección de entrega',
      );
    }
    const order = await this.findOne(id, user);
    await this.orders.update(order.id, {
      deliveryAddress: {
        text: address.text,
        lat: address.lat,
        lng: address.lng,
        building: address.building ?? null,
        houseNumber: address.houseNumber ?? null,
        unit: address.unit ?? null,
        reference: address.reference ?? null,
      },
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

    // T60: Detect if order has any rental items — if so, include customerId
    // and setup_future_usage='off_session' in the PaymentIntent so the
    // PaymentMethod is saved for recurring Stripe Subscription charges.
    const hasRentalItems = order.items?.some(
      (item) => (item.product as Product | undefined)?.pricingMode === 'rental',
    ) ?? false;

    let rentalCustomerId: string | undefined;
    if (hasRentalItems) {
      // Ensure Stripe customer exists (reuse SubscriptionService helper)
      rentalCustomerId = await this.subscriptionService.getOrCreateStripeCustomer(user.id);
    }

    const intentInput: Parameters<typeof this.payments.createAuthorizationIntent>[0] = {
      userId: user.id,
      orderId: order.id,
      amountCents: stripeAmountCents,
    };
    if (hasRentalItems && rentalCustomerId) {
      intentInput.customerId = rentalCustomerId;
      intentInput.setupFutureUsage = 'off_session';
    }

    const created = await this.payments.createAuthorizationIntent(intentInput);

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
      // Wrap cancel in a TX so every side-effect reversal commits atomically
      // with the status flip.
      //
      // Reversed on cancel:
      //   - Credit: refund any creditApplied (T4.4)
      //   - Points: restore claimable status of any entries we redeemed
      //   - Stock: re-increment if the order had been confirmed (stock was
      //     decremented during pending_validation → confirmed_by_colmado)
      //   - Rentals: cancel any pending_setup rentals tied to the order
      const wasStockDecremented =
        order.status === OrderStatus.CONFIRMED_BY_COLMADO ||
        order.status === OrderStatus.IN_DELIVERY_ROUTE;

      await this.dataSource.transaction(async (cancelTx) => {
        await cancelTx
          .getRepository(Order)
          .update(id, { status: OrderStatus.CANCELLED });
        if (parseFloat(order.creditApplied || '0') > 0) {
          await this.credit.reverseCharge(order.id, cancelTx);
        }
        await this.points.reverseRedemptionForOrder(order.id, cancelTx);
        await this.rentalsService.cancelPendingForOrder(order.id, cancelTx);
        if (wasStockDecremented) {
          const itemRepo = cancelTx.getRepository(OrderItem);
          const productRepo = cancelTx.getRepository(Product);
          const items = await itemRepo.find({ where: { orderId: order.id } });
          for (const item of items) {
            await productRepo.increment(
              { id: item.productId },
              'stock',
              item.quantity,
            );
          }
        }
      });
    } else {
      await this.orders.update(id, { status: dto.status });
    }

    return this.findOne(id, user);
  }

  private async markDelivered(orderId: string) {
    let customerId: string | null = null;
    await this.dataSource.transaction(async (tx) => {
      const orderRepo = tx.getRepository(Order);

      // Fetch with a write lock so we can safely decide whether to capture.
      const order = await orderRepo.findOne({
        where: { id: orderId },
        loadEagerRelations: false,
        lock: { mode: 'pessimistic_write' },
      });
      if (!order) throw new NotFoundException('Pedido no encontrado');
      customerId = order.customerId;

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

    // T65: Activate pending_setup rentals for this order OUTSIDE the TX.
    // Per ADR-6: Stripe calls must NOT run inside a DB transaction.
    // Best-effort: activation failure must NOT fail the delivery.
    // The TX has already committed at this point.
    try {
      await this.rentalsService.activateRentalsForOrder(orderId);
    } catch (err) {
      this.logger.error(
        `markDelivered: activateRentalsForOrder failed for order ${orderId} (rentals stay pending_setup): ${(err as Error).message}`,
      );
      Sentry.captureException(err, {
        tags: { module: 'orders', phase: 'rental-activation' },
        extra: { orderId },
      });
    }

    // Reset the bebedero maintenance countdown when this delivery fulfilled a
    // maintenance-service order. Best-effort: must NOT fail the delivery.
    try {
      const orderItems =
        (await this.items.find({
          where: { orderId },
          relations: ['product'],
        })) ?? [];
      const isMaintenanceOrder = orderItems.some(
        (item) => (item.product as Product | undefined)?.isMaintenanceService,
      );
      if (customerId && isMaintenanceOrder) {
        await this.rentalsService.resetMaintenanceForUser(customerId);
      }
    } catch (err) {
      this.logger.error(
        `markDelivered: maintenance reset failed for order ${orderId}: ${(err as Error).message}`,
      );
      Sentry.captureException(err, {
        tags: { module: 'orders', phase: 'maintenance-reset' },
        extra: { orderId },
      });
    }
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
