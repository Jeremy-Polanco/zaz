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
import { UserAddress } from '../../entities/user-address.entity';
import { DeliveryZone } from '../../entities/delivery-zone.entity';
import { resolveZoneId } from '../addresses/resolve-zone';
import { DeliveryZonesService } from '../addresses/delivery-zones.service';
import {
  OrderStatus,
  PaymentMethod,
  UserRole,
  type GeoAddress,
} from '../../entities/enums';
import { AuthenticatedUser } from '../../common/types/authenticated-user';
import { TAX_RATE, computeTaxableBase } from '../../common/tax';
import type { TaxableLine } from '../../common/tax';
import { sortOrdersForDispatch } from './dispatch-sort';
import { CreateOrderDto, DeliveryAddressDto } from './dto/create-order.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { PaymentsService } from '../payments/payments.service';
import { PointsService } from '../points/points.service';
import { InvoicesService } from '../invoices/invoices.service';
import { PromotersService } from '../promoters/promoters.service';
import { SellersService } from '../sellers/sellers.service';
import { ShippingService } from '../shipping/shipping.service';
import { ShippingRateService } from '../shipping/shipping-rate.service';
import { CreditService } from '../credit/credit.service';
import { SubscriptionService } from '../subscription/subscription.service';
import { TwilioService } from '../twilio/twilio.service';
import { OrderNotificationsService } from './order-notifications.service';
import { RentalsService } from '../rentals/rentals.service';
import {
  SUBSCRIBER_BEBEDERO_RENT_CENTS,
  getEffectivePrice,
  resolveBebederoRentCents,
  resolvePremiumBebederoRentCents,
} from '../products/pricing';
import { SubscriptionTier } from '../../entities/subscription-plan.entity';

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
  [OrderStatus.IN_DELIVERY_ROUTE]: [
    OrderStatus.DELIVERED,
    OrderStatus.CANCELLED,
  ],
  [OrderStatus.DELIVERED]: [],
  [OrderStatus.CANCELLED]: [],
};

// Re-exported for backward compatibility; canonical definition lives in common/tax.ts
export { TAX_RATE };

/** Row shape returned by the customer-activity dashboard queries. */
export interface CustomerActivityRow {
  id: string;
  fullName: string;
  phone: string | null;
  lastOrderAt: Date | null;
}

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    @InjectRepository(Order) private readonly orders: Repository<Order>,
    @InjectRepository(OrderItem) private readonly items: Repository<OrderItem>,
    @InjectRepository(Product) private readonly products: Repository<Product>,
    @InjectRepository(UserAddress)
    private readonly userAddresses: Repository<UserAddress>,
    @InjectRepository(DeliveryZone)
    private readonly deliveryZones: Repository<DeliveryZone>,
    private readonly dataSource: DataSource,
    private readonly payments: PaymentsService,
    private readonly points: PointsService,
    private readonly invoices: InvoicesService,
    private readonly promotersService: PromotersService,
    private readonly sellersService: SellersService,
    private readonly shipping: ShippingService,
    private readonly shippingRate: ShippingRateService,
    private readonly credit: CreditService,
    private readonly subscriptionService: SubscriptionService,
    private readonly twilio: TwilioService,
    private readonly rentalsService: RentalsService,
    private readonly orderNotifications: OrderNotificationsService,
    private readonly deliveryZonesService: DeliveryZonesService,
  ) {}

  /**
   * Operaciones que un vendedor SÍ puede hacer sobre un pedido (cotizar, fijar
   * dirección, mover estados). Es seguro abrirlas porque todas resuelven el
   * pedido con `findOne(id, user)`, que ya aplica `buildScope` — un vendedor
   * solo llega a los pedidos de SU cartera. Las destructivas (borrar) siguen
   * siendo exclusivas del super admin.
   */
  private assertCanOperateOrders(user: AuthenticatedUser, action: string) {
    if (
      user.role !== UserRole.SUPER_ADMIN_DELIVERY &&
      user.role !== UserRole.SELLER
    ) {
      throw new ForbiddenException(action);
    }
  }

  private buildScope(user: AuthenticatedUser): FindOptionsWhere<Order> {
    switch (user.role) {
      case UserRole.SUPER_ADMIN_DELIVERY:
        return {};
      case UserRole.SELLER:
        // El vendedor ve SOLO los pedidos de los clientes que tiene asignados.
        // Un vendedor sin cartera no ve nada — nunca "todo".
        return { customer: { sellerId: user.id } };
      case UserRole.CLIENT:
      default:
        return { customerId: user.id };
    }
  }

  /**
   * Lista de pedidos con el alcance del rol.
   *
   * Para el staff (super admin y vendedor) sale en ORDEN DE DESPACHO: los
   * pedidos vivos primero, del más cerca al más lejos del origen del
   * repartidor, y el histórico al final por fecha. El dueño la veía "por más
   * reciente" y tenía que recorrerla entera para armar el recorrido.
   *
   * El cliente la recibe tal cual: la distancia al depósito no le dice nada y
   * resolver el origen sería una consulta de más en cada apertura de la app.
   * `distanceMiles` es opcional justamente por eso — sólo viaja para el staff.
   *
   * Sin paginar a propósito (así estaba): ordenar en memoria es correcto
   * mientras la lista completa siga viniendo en una sola consulta. Si algún
   * día se pagina, el orden tiene que bajar al SQL o la primera página
   * dejaría de ser la de los pedidos más cercanos.
   */
  async findAll(
    user: AuthenticatedUser,
  ): Promise<Array<Order & { distanceMiles?: number | null }>> {
    const orders = await this.orders.find({
      where: this.buildScope(user),
      relations: ['customer', 'items', 'items.product'],
      order: { createdAt: 'DESC' },
    });

    const isStaff =
      user.role === UserRole.SUPER_ADMIN_DELIVERY ||
      user.role === UserRole.SELLER;
    if (!isStaff) return orders;

    const origin = await this.shipping.getOrigin();
    return sortOrdersForDispatch(orders, origin);
  }

  async findOne(id: string, user: AuthenticatedUser) {
    const order = await this.orders.findOne({
      where: { id, ...this.buildScope(user) },
      relations: ['customer', 'items', 'items.product'],
    });
    if (!order)
      throw new NotFoundException('Pedido no encontrado o sin acceso');
    return order;
  }

  async create(
    user: AuthenticatedUser,
    dto: CreateOrderDto,
    opts: {
      allowDuplicateRental?: boolean;
      /**
       * Orden creada por el SISTEMA para entregar un beneficio de la
       * suscripción (bebedero gratis, instalación premium): sin envío, porque
       * la entrega ES el beneficio; ningún cliente la pidió por checkout.
       *
       * No es un descuento al suscriptor —el envío fijo lo paga todo el
       * mundo—: es que estas órdenes tienen que quedar en $0 o
       * `deliverProvisionedOrder` las rechaza y el alquiler no se activa nunca.
       */
      provisioned?: boolean;
    } = {},
  ) {
    if (user.role !== UserRole.CLIENT && user.role !== UserRole.PROMOTER) {
      throw new ForbiddenException('Solo clientes pueden crear pedidos');
    }

    // Propina: digital-only. Cash tips happen in person at delivery — a stored
    // cash tip would inflate the amount the driver tries to collect.
    if (dto.tipPercent != null && dto.paymentMethod !== PaymentMethod.DIGITAL) {
      throw new BadRequestException({
        code: 'TIP_DIGITAL_ONLY',
        message: 'La propina solo aplica a pedidos con pago digital.',
      });
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

    // Pre-check — by default a user may hold only ONE active rental per product.
    // This is what keeps the auto-provisioned free bebedero idempotent against
    // replayed Stripe webhooks (the listener calls create() WITHOUT the flag).
    // Explicit customer orders pass allowDuplicateRental=true to intentionally
    // stack rentals (e.g. a second bebedero, billed at the additional rate).
    if (!opts.allowDuplicateRental) {
      for (const input of dto.items) {
        const product = byId.get(input.productId);
        if (product.pricingMode === 'rental') {
          const existing = await this.rentalsService.findActiveByUserAndProduct(
            user.id,
            product.id,
          );
          if (existing) {
            throw new ConflictException({
              code: 'RENTAL_ALREADY_ACTIVE',
              message: `Ya tenés un alquiler activo de "${product.name}". Cancelá el actual antes de pedir otro.`,
            });
          }
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

    // Subscriber benefits depend on subscription status. Tres beneficios
    // cuelgan de ella: (1) mantenimiento de bebedero gratis, (2) precio de
    // bebedero de suscriptor — el primero sale gratis ($0/mes), cada adicional
    // a $6.99/mes — y (3) el precio de suscriptor por producto. Un bebedero es
    // un producto de alquiler con requiresMaintenance=true.
    //
    // El ENVÍO ya no está en la lista: desde 2026-09-14 el dueño lo cobra a
    // todos ("los suscriptores tampoco van a tener el envío gratis, simplemente
    // va a ser para que tengan el bebedero").
    //
    // Igual la consulta se hace SIEMPRE, una sola vez: toda orden congela
    // `wasSubscriberAtQuote`, que es lo que después explica sus precios.
    const isBebedero = (p: Product | undefined): boolean =>
      p?.pricingMode === 'rental' && p?.requiresMaintenance === true;
    // El producto exclusivo del premium se excluye del beneficio ESTÁNDAR: si
    // pasara por resolveBebederoRentCents, un suscriptor común sin bebederos
    // previos se llevaría gratis (primer bebedero free) el producto de un plan
    // que no paga. Su precio lo resuelve resolvePremiumBebederoRentCents.
    const isStandardBebedero = (p: Product | undefined): boolean =>
      isBebedero(p) && p?.isPremiumSubscriberProduct !== true;

    const hasBebederoItem = dto.items.some((input) =>
      isStandardBebedero(byId.get(input.productId)),
    );
    const hasPremiumProductItem = dto.items.some(
      (input) => byId.get(input.productId)?.isPremiumSubscriberProduct === true,
    );
    const isSubscriber = await this.subscriptionService.isActiveSubscriber(
      user.id,
    );

    // Resolve the per-bebedero subscriber rate (rent cents + which recurring
    // Stripe price to snapshot). Keyed by productId. The ordinal across the
    // user's lifetime decides free vs $6.99: prior count + position in this
    // cart. Only for active subscribers; non-subscribers pay catalog rent.
    const bebederoRateByProductId = new Map<
      string,
      { monthlyRentCents: number; stripePriceId: string }
    >();
    if (isSubscriber && hasBebederoItem) {
      const priorCount = await this.rentalsService.countBebederoRentalsForUser(
        user.id,
      );
      // Additional bebederos rent at the live subscription price (net cents).
      // Falls back to the frozen rate only if no plan is configured.
      const subscriberRentCents =
        (await this.subscriptionService.getPlanNetCents()) ??
        SUBSCRIBER_BEBEDERO_RENT_CENTS;
      const ratePrices =
        await this.rentalsService.ensureBebederoRatePrices(subscriberRentCents);
      let ordinal = priorCount;
      for (const input of dto.items) {
        const product = byId.get(input.productId);
        if (!isStandardBebedero(product)) continue;
        const rent = resolveBebederoRentCents(
          product,
          true,
          ordinal,
          subscriberRentCents,
        );
        if (rent.tier !== 'catalog') {
          bebederoRateByProductId.set(product.id, {
            monthlyRentCents: rent.monthlyRentCents,
            stripePriceId:
              rent.tier === 'free'
                ? ratePrices.freePriceId
                : ratePrices.subscriberPriceId,
          });
        }
        ordinal += 1;
      }
    }

    // Producto exclusivo del plan premium. Su regla es propia: 1 unidad
    // incluida ($0) con la suscripción premium activa, cada adicional al
    // precio de esa suscripción, y sin premium activa cuesta la suscripción
    // + $5. La instalación automática (PremiumProductListener) entra por este
    // mismo camino: la unidad incluida da una orden de $0, que es lo que
    // permite entregarla sola vía deliverProvisionedOrder.
    if (hasPremiumProductItem) {
      const activeTier = await this.subscriptionService.getActiveTier(user.id);
      const premiumActive = activeTier === SubscriptionTier.PREMIUM;
      const premiumNetCents = await this.subscriptionService.getPlanNetCents(
        SubscriptionTier.PREMIUM,
      );
      for (const input of dto.items) {
        const product = byId.get(input.productId);
        if (product.isPremiumSubscriberProduct !== true) continue;
        const priorPremium =
          await this.rentalsService.countRentalsForUserAndProduct(
            user.id,
            product.id,
          );
        const rent = resolvePremiumBebederoRentCents(
          product,
          premiumActive,
          priorPremium,
          premiumNetCents,
        );
        // Sin plan premium configurado no hay tarifas Stripe que asignar: el
        // producto queda en su maquinaria de catálogo (nunca cobra de menos).
        // Es un estado incoherente (premium activo exige que el plan exista) y
        // la instalación queda para el flujo manual/reconcile.
        if (!rent || premiumNetCents == null) continue;
        const rates =
          await this.rentalsService.ensurePremiumBebederoRatePrices(
            premiumNetCents,
          );
        bebederoRateByProductId.set(product.id, {
          monthlyRentCents: rent.monthlyRentCents,
          stripePriceId:
            rent.tier === 'included'
              ? rates.freePriceId
              : rent.tier === 'premium'
                ? rates.premiumPriceId
                : rates.premiumCatalogPriceId,
        });
      }
    }

    const now = new Date();
    let subtotalCents = 0;
    const builtItems = dto.items.map((input) => {
      const product = byId.get(input.productId);
      let lineCents: number;
      let priceAtOrder: string;

      if (product.pricingMode === 'rental') {
        // T58: For rental items, the first month's rent is charged in the order.
        // Subscriber bebedero rate overrides catalog rent when it applies.
        const rentCents =
          bebederoRateByProductId.get(product.id)?.monthlyRentCents ??
          product.monthlyRentCents;
        lineCents = rentCents * input.quantity;
        priceAtOrder = (rentCents / 100).toFixed(2);
      } else if (product.isMaintenanceService && isSubscriber) {
        // Free bebedero maintenance for active subscribers.
        lineCents = 0;
        priceAtOrder = '0.00';
      } else {
        const effective = getEffectivePrice(product, now, { isSubscriber });
        lineCents = effective.priceCents * input.quantity;
        priceAtOrder = (effective.priceCents / 100).toFixed(2);
      }

      subtotalCents += lineCents;
      return {
        productId: input.productId,
        quantity: input.quantity,
        priceAtOrder,
        // Categoría fiscal del producto al momento de la orden — la base
        // gravable se arma solo con las líneas 'standard'.
        taxCategory: product.taxCategory,
        lineCents,
      };
    });

    // Líneas para el cálculo fiscal. Un pedido de solo agua (exenta) no paga
    // impuesto, ni siquiera sobre el envío.
    const taxLines: TaxableLine[] = builtItems.map((i) => ({
      lineCents: i.lineCents,
      taxCategory: i.taxCategory,
    }));

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

      // Cotización. TODA orden de cliente nace con el envío fijo ya cargado —
      // el viaje se cobra siempre, suscriptor o no. La única excepción es la
      // orden que provisiona el sistema (`opts.provisioned`): el bebedero
      // gratis y la instalación premium NO las pidió nadie por checkout y
      // tienen que quedar en $0 (ver el doc de `opts`).
      //
      // El monto ya no es una constante: lo fija el super admin desde el panel
      // (`PUT /shipping/rate`) y lo lee ShippingRateService. Se pide UNA vez
      // por pedido —es un lookup por PK, no vale la pena cachearlo— y el valor
      // queda congelado en la orden, así que subir la tarifa nunca re-cotiza
      // pedidos ya creados.
      //
      // Con `skipQuote` (todos los ítems con requiresQuote=false) la orden se
      // auto-cotiza acá: se calcula el impuesto igual que en setQuote y queda
      // directamente en QUOTED, así el cliente paga el total FINAL en el acto.
      //
      // Sin `skipQuote` la orden queda en PENDING_QUOTE con el envío fijo ya
      // puesto — el formulario del admin pre-carga `order.shipping` cuando es
      // > 0, así que sólo confirma o ajusta la tarifa vigente. El impuesto y
      // la base gravable siguen en 0 hasta setQuote, de modo que su
      // `totalAmount` es un total PARCIAL (neto + propina, sin impuesto).
      //
      // La base gravable sale SOLO de las líneas 'standard'; el envío y los
      // puntos se prorratean por la parte gravable del pedido (ver
      // common/tax.ts). Un pedido de puro agua exenta no paga impuesto ni
      // siquiera por el viaje.
      //
      // La DIRECCIÓN se resuelve antes que el impuesto y no después: la TASA
      // sale de la zona de reparto a la que cae esa dirección (NJ 6.625%, NYC
      // 8.875%). Calculando el impuesto primero se le cobraba a todo el mundo
      // la constante global.
      //
      // When no address is supplied, fall back to the customer's default saved
      // location so subsequent orders auto-inherit it (the colmado can still
      // re-pin at delivery). Mirrors the frontend userAddressToGeoAddress map.
      //
      // El `postalCode` del snapshot lo ESCRIBE el cliente: si fuera la única
      // fuente de la tasa, el cliente elegiría cuánto impuesto paga. Por eso,
      // cuando manda `deliveryAddressId`, la plata sale de la fila real de su
      // libreta — leída con el userId adentro del where, que es el chequeo de
      // propiedad.
      let bookAddress: UserAddress | null = null;
      if (dto.deliveryAddressId) {
        bookAddress = await this.userAddresses.findOne({
          where: { id: dto.deliveryAddressId, userId: user.id },
        });
        if (!bookAddress) {
          // Id de otro, o borrado entre que el cliente abrió el checkout y
          // mandó el pedido. No se rompe la compra: se cobra con el ZIP
          // posteado, igual que antes de que el campo existiera.
          this.logger.warn(
            `deliveryAddressId ${dto.deliveryAddressId} no pertenece al usuario ${user.id} — la tasa sale del ZIP posteado`,
          );
        }
      }

      let resolvedDeliveryAddress: GeoAddress | null =
        dto.deliveryAddress ?? null;
      if (!resolvedDeliveryAddress) {
        // Sin snapshot: la fila elegida, y si no hay, la dirección por defecto.
        const source =
          bookAddress ??
          (await this.userAddresses.findOne({
            where: { userId: user.id, isDefault: true },
          }));
        if (source) {
          bookAddress = source;
          resolvedDeliveryAddress = this.userAddressToDeliveryAddress(source);
        }
      }

      // Sin zona y sin ZIP esto devuelve TAX_RATE: el pedido de una dirección
      // que no cae en ninguna zona sigue pagando lo que pagaba siempre.
      //
      // Con fila de libreta se pregunta por SUS datos (el ZIP manda, el
      // `zone_id` es el respaldo — ver delivery-zones.service.ts) y el ZIP
      // posteado se ignora para la plata.
      const { taxRate } = await this.deliveryZonesService.resolveTaxRate(
        bookAddress
          ? {
              zoneId: bookAddress.zoneId ?? null,
              postalCode: bookAddress.postalCode ?? null,
            }
          : {
              zoneId: null,
              postalCode: resolvedDeliveryAddress?.postalCode ?? null,
            },
      );

      const flatShippingCents = await this.shippingRate.getFlatShippingCents();
      const shippingCents = opts.provisioned ? 0 : flatShippingCents;
      const base = computeTaxableBase(taxLines, {
        shippingCents,
        pointsRedeemedCents,
        taxRate,
      });
      // Lo que el cliente termina debiendo sigue descontando TODOS los puntos,
      // no solo la parte prorrateada — el prorrateo es únicamente para repartir
      // el descuento entre la mitad gravada y la exenta.
      const netCents = Math.max(
        0,
        subtotalCents + shippingCents - pointsRedeemedCents,
      );
      const taxCents = skipQuote ? base.taxCents : 0;
      // Propina: % of the product subtotal (before points/credit), untaxed —
      // it rides on top of the taxed total and flows into the Stripe charge.
      const tipCents = dto.tipPercent
        ? Math.round((subtotalCents * dto.tipPercent) / 100)
        : 0;
      const totalCents = netCents + taxCents + tipCents;

      const order = orderRepo.create({
        customerId: user.id,
        status: skipQuote ? OrderStatus.QUOTED : OrderStatus.PENDING_QUOTE,
        // Defaults to the customer's saved default address (above); the
        // super-admin can override/re-pin at delivery time.
        deliveryAddress: resolvedDeliveryAddress,
        subtotal: (subtotalCents / 100).toFixed(2),
        pointsRedeemed: (pointsRedeemedCents / 100).toFixed(2),
        shipping: (shippingCents / 100).toFixed(2),
        tax: (taxCents / 100).toFixed(2),
        // La tasa se CONGELA acá: `orders.tax_rate` deja de ser una constante
        // decorativa y pasa a explicar, años después, por qué este pedido pagó
        // lo que pagó. Cambiar la tasa de la zona no re-cotiza lo ya vendido.
        taxRate: taxRate.toFixed(5),
        // Congela la base gravable — sin esto el impuesto de un pedido mixto
        // no se puede reconstruir después.
        taxableSubtotal: ((skipQuote ? base.taxableCents : 0) / 100).toFixed(2),
        tip: (tipCents / 100).toFixed(2),
        totalAmount: (totalCents / 100).toFixed(2),
        quotedAt: skipQuote ? now : null,
        skipQuote,
        wasSubscriberAtQuote: isSubscriber,
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
        const product = byId.get(input.productId);
        if (product.pricingMode === 'rental') {
          const rate = bebederoRateByProductId.get(product.id);
          await this.rentalsService.createForOrder(
            {
              userId: user.id,
              productId: product.id,
              orderId: persisted.id,
              product,
              monthlyRentCentsOverride: rate?.monthlyRentCents,
              stripePriceIdOverride: rate?.stripePriceId,
              allowDuplicate: opts.allowDuplicateRental,
            },
            tx,
          );
        }
      }

      // T4.3 (continued): Apply credit charge AFTER order+items persisted, BEFORE points
      if (creditAppliedCents > 0) {
        await this.credit.applyCharge(
          {
            userId: user.id,
            orderId: persisted.id,
            amountCents: creditAppliedCents,
          },
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

    let order = await this.findOne(saved.id, user);

    // Auto-confirm the orders the customer should never have to tap "Confirmar
    // pedido" for (the provisioned bebedero, standardized water deliveries,
    // etc.). Only orders already in QUOTED qualify — the helper re-checks the
    // shipping guard + that nothing is owed by card. Non-blocking.
    if (order.status === OrderStatus.QUOTED) {
      await this.tryAutoConfirmFreeOrder(order.id);
      order = await this.findOne(saved.id, user);
    }

    // Fire-and-forget SMS notification — never block the HTTP response on Twilio.
    void this.twilio
      .sendOrderNotificationSms(order)
      .catch((err) =>
        this.logger.error(
          `Order SMS notification failed for order ${order.id}: ${(err as Error).message}`,
        ),
      );

    // Customer-facing tracking: "recibimos tu pedido" (or "confirmado" if the
    // order auto-confirmed above). Fire-and-forget like the SMS.
    this.orderNotifications.notifyStatus(order);

    return order;
  }

  /**
   * Admin hard-delete. Restricted to CANCELLED orders on purpose: the
   * cancellation path is what reverses credit, points and stock — deleting an
   * active order directly would skip those reversals. FK behavior on delete:
   * order_items + invoice CASCADE; rentals/credit_movements SET NULL;
   * points_ledger_entries.order_id has no FK constraint.
   */
  async deleteOrder(
    id: string,
    user: AuthenticatedUser,
  ): Promise<{ deleted: true }> {
    if (user.role !== UserRole.SUPER_ADMIN_DELIVERY) {
      throw new ForbiddenException(
        'Solo el super admin puede eliminar pedidos',
      );
    }
    const order = await this.orders.findOne({ where: { id } });
    if (!order) throw new NotFoundException('Pedido no encontrado');
    if (order.status !== OrderStatus.CANCELLED) {
      throw new BadRequestException({
        code: 'ORDER_NOT_CANCELLED',
        message:
          'Solo se pueden eliminar pedidos cancelados. Cancelá el pedido primero.',
      });
    }
    await this.orders.delete(id);
    return { deleted: true };
  }

  /**
   * Admin dashboard: customer activity buckets. "Today" follows the ops
   * timezone (America/New_York — same as WinBackCron); inactivity windows are
   * rolling and INCLUDE clients who never ordered (lastOrderAt null).
   */
  async getCustomerActivity(user: AuthenticatedUser): Promise<{
    orderedToday: { count: number; customers: CustomerActivityRow[] };
    inactive7d: { count: number; customers: CustomerActivityRow[] };
    inactive30d: { count: number; customers: CustomerActivityRow[] };
  }> {
    this.assertCanOperateOrders(
      user,
      'Solo el super admin o un vendedor pueden ver la actividad de clientes',
    );

    // El vendedor ve la actividad SOLO de su cartera. El filtro va parametrizado
    // ($1 = seller id) y no interpolado: este es SQL crudo y el id viene del
    // token, pero concatenar identificadores acá es cómo se cuela una inyección
    // el día que alguien reutilice el patrón con input del cliente.
    const sellerId = user.role === UserRole.SELLER ? user.id : null;
    const sellerFilter = sellerId ? 'AND u.seller_id = $1' : '';
    const sellerParams = sellerId ? [sellerId] : [];

    const orderedToday: CustomerActivityRow[] = await this.orders.query(
      `
      SELECT u.id, u.full_name AS "fullName", u.phone,
             MAX(o.created_at) AS "lastOrderAt"
      FROM users u
      JOIN orders o ON o.customer_id = u.id AND o.status != 'cancelled'
      WHERE u.role = 'client'
        ${sellerFilter}
        AND (o.created_at AT TIME ZONE 'America/New_York')::date =
            (now() AT TIME ZONE 'America/New_York')::date
      GROUP BY u.id, u.full_name, u.phone
      ORDER BY MAX(o.created_at) DESC
      `,
      sellerParams,
    );

    const inactiveSince = (days: number): Promise<CustomerActivityRow[]> =>
      this.orders.query(
        `
        SELECT u.id, u.full_name AS "fullName", u.phone,
               MAX(o.created_at) AS "lastOrderAt"
        FROM users u
        LEFT JOIN orders o ON o.customer_id = u.id AND o.status != 'cancelled'
        WHERE u.role = 'client'
        ${sellerId ? 'AND u.seller_id = $2' : ''}
        GROUP BY u.id, u.full_name, u.phone
        HAVING MAX(o.created_at) IS NULL
            OR MAX(o.created_at) <= now() - ($1 || ' days')::interval
        ORDER BY MAX(o.created_at) DESC NULLS LAST
        `,
        sellerId ? [days, sellerId] : [days],
      );

    const inactive7d = await inactiveSince(7);
    const inactive30d = await inactiveSince(30);

    return {
      orderedToday: { count: orderedToday.length, customers: orderedToday },
      inactive7d: { count: inactive7d.length, customers: inactive7d },
      inactive30d: { count: inactive30d.length, customers: inactive30d },
    };
  }

  /**
   * ¿A este pedido todavía se le puede cambiar el impuesto?
   *
   * Sí mientras el cliente NO haya puesto la plata. Dos señales, porque hay dos
   * formas de pagar:
   *  - `stripePaymentIntentId`: ya existe una retención de tarjeta por un monto
   *    concreto. Mover la tasa después es cobrar distinto de lo autorizado.
   *  - el ESTADO: el efectivo nunca tiene intent, así que ahí es lo único que
   *    queda. PENDING_QUOTE y QUOTED son los dos estados ANTERIORES a que el
   *    pedido se confirme; de PENDING_VALIDATION en adelante ya se descontó
   *    stock y la venta está cerrada (ver ALLOWED_TRANSITIONS y `authorize`,
   *    que sólo acepta QUOTED).
   *
   * Existe porque el flujo real del negocio cotiza DESPUÉS de saber la
   * dirección: el cliente pide (muchas veces sin dirección), el admin pincha la
   * ubicación y recién ahí cotiza. Congelar la tasa al crear el pedido le
   * cobraba a todo New Jersey el fallback de 8.887%.
   */
  private isTaxRateRepriceable(order: Order): boolean {
    if (order.stripePaymentIntentId) return false;
    return (
      order.status === OrderStatus.PENDING_QUOTE ||
      order.status === OrderStatus.QUOTED
    );
  }

  /**
   * La tasa que se le aplica AHORA a este pedido, y si hay que re-congelarla.
   *
   * Repreciable → se vuelve a resolver la zona por el código postal del pedido
   * (o el que se está por pinchar). No repreciable → manda la que quedó
   * congelada; ilegible (columna vacía, pedido viejo) cae en la constante
   * histórica y NUNCA en 0, que sería cobrar de menos.
   *
   * Se pregunta por ZIP y no por el `zone_id` de la libreta a propósito: la
   * dirección de un pedido es un snapshot JSONB que sólo tiene el código
   * postal, y ése es igual el dato primario en todo el sistema (ver
   * delivery-zones.service.ts).
   */
  private async currentTaxRate(
    order: Order,
    postalCode: string | null = order.deliveryAddress?.postalCode ?? null,
  ): Promise<{ taxRate: number; repriced: boolean }> {
    if (!this.isTaxRateRepriceable(order)) {
      const frozen = parseFloat(order.taxRate ?? '');
      return {
        taxRate: Number.isFinite(frozen) ? frozen : TAX_RATE,
        repriced: false,
      };
    }
    const { taxRate } = await this.deliveryZonesService.resolveTaxRate({
      zoneId: null,
      postalCode,
    });
    return { taxRate, repriced: true };
  }

  /** Envío + recargo por distancia, que para el impuesto son el mismo cargo. */
  private deliveryCentsOf(order: Order): number {
    return (
      Math.round(parseFloat(order.shipping ?? '0') * 100) +
      Math.round(parseFloat(order.deliverySurcharge ?? '0') * 100)
    );
  }

  /**
   * Impuesto, base gravable y total de un pedido a una tasa dada.
   *
   * Vive acá y no adentro de `setQuote` porque re-pinchar la dirección de un
   * pedido YA cotizado también tiene que re-hacer esta cuenta: cambiarle la
   * tasa sin recalcular el impuesto dejaría la orden diciendo que cobró 6.625%
   * sobre un monto calculado al 8.887%.
   *
   * La base sale de las LÍNEAS: sólo los ítems 'standard' pagan impuesto, y el
   * envío y los puntos se prorratean por la parte gravable (ver common/tax.ts).
   * Si el pedido llegara sin líneas se cae a "todo gravable", que es el
   * comportamiento histórico — nunca cobrar de menos.
   */
  private quoteTotals(
    order: Order,
    deliveryCents: number,
    taxRate: number,
  ): { taxCents: number; taxableCents: number; totalCents: number } {
    const subtotalCents = Math.round(parseFloat(order.subtotal) * 100);
    const pointsRedeemedCents = Math.round(
      parseFloat(order.pointsRedeemed) * 100,
    );
    const taxLines: TaxableLine[] = (order.items ?? []).map((item) => ({
      lineCents:
        Math.round(parseFloat(item.priceAtOrder) * 100) * item.quantity,
      taxCategory: item.product?.taxCategory ?? 'standard',
    }));
    const opts = {
      shippingCents: deliveryCents,
      pointsRedeemedCents,
      taxRate,
    };
    const base = taxLines.length
      ? computeTaxableBase(taxLines, opts)
      : computeTaxableBase(
          [{ lineCents: subtotalCents, taxCategory: 'standard' }],
          opts,
        );

    // El neto que paga el cliente descuenta TODOS los puntos; el prorrateo solo
    // reparte el descuento entre la mitad gravada y la exenta.
    const netCents = Math.max(
      0,
      subtotalCents + deliveryCents - pointsRedeemedCents,
    );
    // Preserve the propina chosen at checkout — untaxed, rides on the total.
    const tipCents = Math.round(parseFloat(order.tip ?? '0') * 100);
    return {
      taxCents: base.taxCents,
      taxableCents: base.taxableCents,
      totalCents: netCents + base.taxCents + tipCents,
    };
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
    opts: {
      /**
       * Recargo por distancia en centavos. Omitirlo NO borra el recargo que ya
       * tenga la orden — re-cotizar no puede hacer desaparecer plata en
       * silencio; para sacarlo hay que mandar 0 explícitamente.
       */
      surchargeCents?: number;
      /** Día de reparto asignado ('YYYY-MM-DD'), o null para desasignarlo. */
      scheduledDeliveryDate?: string | null;
    } = {},
  ) {
    // El vendedor puede cotizar los pedidos de SU cartera: `findOne(id, user)`
    // más abajo aplica el scope, así que no alcanza a los demás.
    this.assertCanOperateOrders(
      user,
      'Solo el super admin o el vendedor asignado pueden cotizar pedidos',
    );
    if (!Number.isInteger(shippingCents) || shippingCents < 0) {
      throw new BadRequestException('shippingCents inválido');
    }
    if (
      opts.surchargeCents !== undefined &&
      (!Number.isInteger(opts.surchargeCents) || opts.surchargeCents < 0)
    ) {
      throw new BadRequestException('surchargeCents inválido');
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

    // La suscripción ya NO perdona el envío (regla del dueño, 2026-09-14: "los
    // suscriptores tampoco van a tener el envío gratis"). Lo que tipea el admin
    // se cobra tal cual, sea quien sea el cliente; `isSub` se guarda sólo como
    // dato de la cotización (`wasSubscriberAtQuote`).
    const isSub = await this.subscriptionService.isActiveSubscriber(
      order.customerId,
    );
    const effectiveShippingCents = shippingCents;

    // El recargo por distancia vive en su propia columna y no dentro de
    // `shipping` porque es OTRO cargo: el envío es el viaje, el recargo es la
    // distancia. Van en renglones separados en la factura del cliente y se
    // congelan por separado en el invoice, así que meterlos en la misma celda
    // haría imposible reconstruir después qué se le cobró por cada cosa.
    const surchargeCents =
      opts.surchargeCents ??
      Math.round(parseFloat(order.deliverySurcharge ?? '0') * 100);

    // Para el impuesto, envío y recargo son lo mismo: dos cargos de entrega
    // que se prorratean por la parte gravable del pedido (ver common/tax.ts).
    // Sumarlos acá deja la matemática existente intacta — un pedido de agua
    // exenta sigue sin pagar impuesto por el viaje.
    const deliveryCents = effectiveShippingCents + surchargeCents;

    // La tasa SÍ se vuelve a resolver mientras el pedido siga siendo
    // repreciable, porque el orden real es "pido → me pinchan la dirección →
    // me cotizan": al crearse, la mitad de los pedidos no tenía dirección y se
    // congelaba el fallback. Ya autorizado (o confirmado, si es efectivo) manda
    // la tasa congelada: re-resolver ahí re-cotizaría una venta cerrada, y
    // encima con la zona de hoy y no con la de entonces.
    const { taxRate, repriced } = await this.currentTaxRate(order);
    const { taxCents, taxableCents, totalCents } = this.quoteTotals(
      order,
      deliveryCents,
      taxRate,
    );

    await this.orders.update(id, {
      shipping: (effectiveShippingCents / 100).toFixed(2),
      deliverySurcharge: (surchargeCents / 100).toFixed(2),
      // `undefined` deja el día como estaba; `null` lo desasigna.
      ...(opts.scheduledDeliveryDate !== undefined
        ? { scheduledDeliveryDate: opts.scheduledDeliveryDate }
        : {}),
      tax: (taxCents / 100).toFixed(2),
      // La tasa re-resuelta se CONGELA en la misma escritura que el impuesto
      // que la usó: separadas, un error entre medio dejaría la orden diciendo
      // que cobró una tasa distinta de la que aplicó.
      ...(repriced ? { taxRate: taxRate.toFixed(5) } : {}),
      taxableSubtotal: (taxableCents / 100).toFixed(2),
      totalAmount: (totalCents / 100).toFixed(2),
      status: OrderStatus.QUOTED,
      quotedAt: order.quotedAt ?? new Date(),
      wasSubscriberAtQuote: isSub,
    });

    // Entrega cotizada en $0 → no queda nada que cobrar por tarjeta:
    // auto-confirmamos así el cliente se ahorra el tap de confirmar.
    //
    // Mira `deliveryCents`, NO sólo el envío: el admin puede perdonar el envío
    // y aun así cobrar el recargo por distancia. Con el guard viejo esa orden
    // auto-confirmaba como "gratis" y el recargo no se cobraba nunca.
    if (deliveryCents === 0) {
      await this.tryAutoConfirmFreeOrder(id);
    }

    const quoted = await this.findOne(id, user);
    // "Tu cotización está lista" (or "confirmado" if it auto-confirmed above).
    this.orderNotifications.notifyStatus(quoted);
    // Si la cotización además ESTRENA día de reparto, va el aviso del día. Se
    // compara contra el valor previo para no spamear al cliente cada vez que el
    // admin re-cotiza sin tocar la fecha.
    if (
      opts.scheduledDeliveryDate != null &&
      opts.scheduledDeliveryDate !== order.scheduledDeliveryDate
    ) {
      this.orderNotifications.notifyScheduledDelivery(quoted);
    }
    return quoted;
  }

  /**
   * El admin le asigna (o le saca) el DÍA de reparto a un pedido.
   *
   * Pedido del dueño (2026-09-14): al cliente lejano hay que poder decirle qué
   * día le toca el delivery. Va por su propio endpoint y NO por setQuote porque
   * asignar el día no toca plata ni estado: un pedido ya confirmado se puede
   * reprogramar sin volver a QUOTED.
   *
   * @param date 'YYYY-MM-DD', o `null` para desasignarlo.
   */
  async setScheduledDeliveryDate(
    id: string,
    date: string | null,
    user: AuthenticatedUser,
  ) {
    // El vendedor puede programar los pedidos de SU cartera: `findOne(id, user)`
    // aplica el scope, así que no alcanza a los demás.
    this.assertCanOperateOrders(
      user,
      'Solo el super admin o el vendedor asignado pueden programar entregas',
    );

    const order = await this.findOne(id, user);

    if (
      order.status === OrderStatus.DELIVERED ||
      order.status === OrderStatus.CANCELLED
    ) {
      // Ya se entregó o se canceló: programar el reparto no significa nada y el
      // aviso al cliente sería absurdo.
      throw new BadRequestException(
        `No se puede programar la entrega de un pedido en estado ${order.status}`,
      );
    }

    const changed = date !== order.scheduledDeliveryDate;

    await this.orders.update(id, { scheduledDeliveryDate: date });

    const updated = await this.findOne(id, user);
    // Sólo se avisa cuando hay día NUEVO. Desasignar (null) no notifica — no
    // hay nada que contarle al cliente — y re-guardar la misma fecha tampoco.
    if (date != null && changed) {
      this.orderNotifications.notifyScheduledDelivery(updated);
    }
    return updated;
  }

  /**
   * Maps a saved UserAddress to an order's GeoAddress snapshot. Mirrors the
   * frontend userAddressToGeoAddress: line2 folds into the text line, building
   * carries over, and the driver note (instructions) becomes the reference.
   */
  private userAddressToDeliveryAddress(a: UserAddress): GeoAddress {
    const line2 = (a.line2 ?? '').trim();
    const text = line2 ? `${a.line1}, ${line2}` : a.line1;
    const building = (a.building ?? '').trim();
    const reference = (a.instructions ?? '').trim();
    return {
      text,
      lat: a.lat,
      lng: a.lng,
      building: building || null,
      houseNumber: null,
      unit: null,
      reference: reference || null,
      // El ZIP viaja al snapshot para que la ruta del día lo muestre sin tener
      // que abrir la libreta del cliente. Las direcciones viejas todavía no lo
      // tienen: null es un valor esperado, no un faltante.
      postalCode: a.postalCode ?? null,
    };
  }

  /**
   * Super-admin sets/updates an order's delivery address. Used at delivery
   * time: the colmado captures the customer's GPS on arrival and pins the
   * exact destination. The FIRST location pinned for a customer who has no
   * saved address yet is auto-saved to their address book (as default), so
   * subsequent orders auto-inherit it; further locations are added explicitly.
   *
   * TOCA `order.taxRate` mientras el pedido todavía sea repreciable (ver
   * `isTaxRateRepriceable`): la dirección que acaba de pincharse es la que
   * decide el impuesto, y el formulario de cotización del admin lee
   * `order.taxRate` para mostrar el porcentaje. Sin esto el admin cotizaría
   * mirando el 8.887% del fallback aunque la chincheta esté en New Jersey.
   *
   * Una vez autorizado (o confirmado, si es efectivo) NO se toca: ahí afinar la
   * ubicación al llegar no puede cambiar el impuesto de una venta ya cerrada.
   */
  async setDeliveryAddress(
    id: string,
    address: DeliveryAddressDto,
    user: AuthenticatedUser,
  ) {
    this.assertCanOperateOrders(
      user,
      'Solo el super admin o el vendedor asignado pueden fijar la dirección de entrega',
    );
    const order = await this.findOne(id, user);

    // La tasa sale del ZIP que se está pinchando AHORA, no del que traía el
    // pedido. El `zone_id` de la dirección que se auto-guarda más abajo no hace
    // falta: se deriva de este mismo código postal con el mismo resolutor, y el
    // ZIP es el dato primario (ver delivery-zones.service.ts) — sin ZIP esa
    // fila tampoco tendría zona.
    const { taxRate, repriced } = await this.currentTaxRate(
      order,
      address.postalCode ?? null,
    );
    // Un pedido ya COTIZADO tiene impuesto calculado: moverle la tasa sin
    // rehacer la cuenta lo dejaría diciendo que cobró 6.625% sobre un monto
    // sacado al 8.887%. Uno sin cotizar tiene tax = 0 a propósito — su impuesto
    // recién nace en setQuote.
    const requote =
      repriced && order.status === OrderStatus.QUOTED
        ? this.quoteTotals(order, this.deliveryCentsOf(order), taxRate)
        : null;

    await this.orders.update(order.id, {
      deliveryAddress: {
        text: address.text,
        lat: address.lat,
        lng: address.lng,
        building: address.building ?? null,
        houseNumber: address.houseNumber ?? null,
        unit: address.unit ?? null,
        reference: address.reference ?? null,
        postalCode: address.postalCode ?? null,
      },
      ...(repriced ? { taxRate: taxRate.toFixed(5) } : {}),
      ...(requote
        ? {
            tax: (requote.taxCents / 100).toFixed(2),
            taxableSubtotal: (requote.taxableCents / 100).toFixed(2),
            totalAmount: (requote.totalCents / 100).toFixed(2),
          }
        : {}),
    });

    // Auto-save the FIRST location to the customer's address book so future
    // orders inherit it. Only when they have none yet — additional locations
    // are added deliberately via the users module. Non-blocking: a failure
    // here must not undo the order's pinned location.
    try {
      const existing = await this.userAddresses.count({
        where: { userId: order.customerId },
      });
      if (existing === 0) {
        const houseNumber = (address.houseNumber ?? '').trim();
        const line1 =
          address.text?.trim() ||
          (houseNumber ? `Casa ${houseNumber}` : 'Ubicación');
        // En la web el cliente no carga direcciones: esta chincheta ES su
        // libreta. Si no viajara el ZIP (y la zona que se deriva de él), el
        // cliente quedaría sin código postal aunque el admin lo haya escrito.
        // Misma regla que AddressesService: sin ZIP no se consultan zonas.
        const postalCode = address.postalCode?.trim() || null;
        const zoneId = postalCode
          ? resolveZoneId(
              postalCode,
              await this.deliveryZones.find({ where: { isActive: true } }),
            )
          : null;
        await this.userAddresses.save(
          this.userAddresses.create({
            userId: order.customerId,
            label: 'Principal',
            line1,
            line2: address.unit?.trim() || null,
            building: address.building?.trim() || null,
            instructions: address.reference?.trim() || null,
            lat: address.lat,
            lng: address.lng,
            postalCode,
            zoneId,
            isDefault: true,
          }),
        );
      }
    } catch (err) {
      this.logger.warn(
        `Auto-save of first address for customer ${order.customerId} failed: ${
          (err as Error).message
        }`,
      );
    }

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
      // Self-heal: the hold is already authorized at Stripe but the webhook
      // that advances the order never reached us. A PaymentSheet cannot
      // present an authorized intent, so instead of bouncing the customer we
      // converge the order right here and tell them it's already handled.
      if (
        existing.status === 'requires_capture' ||
        existing.status === 'succeeded'
      ) {
        await this.payments.markAuthorizedByIntentId(existing.id);
        await this.autoConfirmSkipQuoteByIntentId(existing.id);
        throw new ConflictException({
          code: 'ALREADY_AUTHORIZED',
          message: 'Tu pago ya fue autorizado — el pedido se está confirmando.',
        });
      }
      if (existing.status !== 'canceled') {
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
    const hasRentalItems =
      order.items?.some((item) => item.product?.pricingMode === 'rental') ??
      false;

    let rentalCustomerId: string | undefined;
    if (hasRentalItems) {
      // Ensure Stripe customer exists (reuse SubscriptionService helper)
      rentalCustomerId =
        await this.subscriptionService.getOrCreateStripeCustomer(user.id);
    }

    const intentInput: Parameters<
      typeof this.payments.createAuthorizationIntent
    >[0] = {
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

    // Skip-cotización orders have nothing for the colmado to quote/review, so
    // once confirmed they advance straight to CONFIRMED_BY_COLMADO (stock
    // decremented). Non-blocking — see tryAutoConfirmSkipQuote.
    if (order.skipQuote) {
      await this.tryAutoConfirmSkipQuote(id);
    }

    return this.findOne(id, user);
  }

  /**
   * Backward-compatible alias kept so existing clients don't break.
   * @deprecated Use confirmNonStripeOrder instead.
   */
  async confirmCashOrder(id: string, user: AuthenticatedUser) {
    return this.confirmNonStripeOrder(id, user);
  }

  /**
   * Webhook entry point: after a digital order's card hold is authorized
   * (PaymentsService.markAuthorizedByIntentId moved it QUOTED →
   * PENDING_VALIDATION), auto-confirm it if it's a skip-cotización order.
   * Called from PaymentsController.dispatch on
   * `payment_intent.amount_capturable_updated`. No-op for normal orders.
   */
  async autoConfirmSkipQuoteByIntentId(intentId: string): Promise<void> {
    const order = await this.orders.findOne({
      where: { stripePaymentIntentId: intentId },
    });
    if (!order) return;
    if (!order.skipQuote) return;
    if (order.status !== OrderStatus.PENDING_VALIDATION) return;
    await this.tryAutoConfirmSkipQuote(order.id);
  }

  /**
   * Auto-advance a skip-cotización order PENDING_VALIDATION →
   * CONFIRMED_BY_COLMADO once payment has settled (cash confirm or card
   * authorization). Skip-quote orders need no admin review (no shipping to
   * quote), so we confirm + decrement stock automatically.
   *
   * NON-BLOCKING: confirmAndDecrementStock throws on insufficient stock (or any
   * error). We swallow it and leave the order in PENDING_VALIDATION so the admin
   * can resolve it manually — this must never break the cash-confirm response
   * or the Stripe webhook.
   */
  private async tryAutoConfirmSkipQuote(orderId: string): Promise<void> {
    try {
      await this.confirmAndDecrementStock(orderId);
    } catch (err) {
      this.logger.warn(
        `auto-confirm skip-quote order ${orderId} failed — left in PENDING_VALIDATION for manual review: ${
          (err as Error).message
        }`,
      );
    }
  }

  /**
   * Auto-confirm an order the customer should never have to tap "Confirmar
   * pedido" for: one whose total the customer already accepted and with nothing
   * owed upfront by card. Fires when an order ENTERS the QUOTED state — at
   * creation for skip-cotización orders (el bebedero que provisiona el
   * sistema, standardized water deliveries) and at setQuote when the admin
   * quotes the delivery at $0. Advances QUOTED → PENDING_VALIDATION →
   * CONFIRMED_BY_COLMADO (decrements stock).
   *
   * Guardrail de envío: sólo aplica a las órdenes que NO son skip_quote. En una
   * skip-cotización el cliente ya aceptó el total FINAL —envío fijo incluido—
   * en el checkout, así que cobrarle el viaje no es motivo para trabarla. El
   * guard existe para la orden que cotiza el admin: ésa el cliente todavía no
   * la vio y tiene que confirmarla a mano.
   *
   * Guardrail de plata: only when there is nothing to charge by card — cash
   * (paid on delivery), $0 total, or fully covered by credit. A digital order
   * that still owes a balance is left in QUOTED so the customer authorizes
   * payment.
   *
   * NON-BLOCKING: any failure (e.g. insufficient stock) is swallowed and the
   * order left for manual handling — this must never break order creation or
   * quoting. Mirrors tryAutoConfirmSkipQuote.
   */
  private async tryAutoConfirmFreeOrder(orderId: string): Promise<void> {
    try {
      const order = await this.orders.findOne({ where: { id: orderId } });
      if (!order) return;
      if (order.status !== OrderStatus.QUOTED) return;
      // A digital order awaiting its card hold is driven by the payment webhook.
      if (order.stripePaymentIntentId !== null) return;

      const shippingCents = Math.round(parseFloat(order.shipping) * 100);
      // Orden cotizada por el admin con envío cobrado → confirmación manual.
      if (!order.skipQuote && shippingCents !== 0) return;

      const totalCents = Math.round(parseFloat(order.totalAmount) * 100);
      const creditAppliedCents = Math.round(
        parseFloat(order.creditApplied) * 100,
      );
      const nothingOwedByCard =
        order.paymentMethod === PaymentMethod.CASH ||
        totalCents === 0 ||
        creditAppliedCents >= totalCents;
      if (!nothingOwedByCard) return; // digital balance → must authorize payment

      await this.orders.update(orderId, {
        status: OrderStatus.PENDING_VALIDATION,
      });
      await this.confirmAndDecrementStock(orderId);
    } catch (err) {
      this.logger.warn(
        `auto-confirm free order ${orderId} failed — left for manual confirm: ${
          (err as Error).message
        }`,
      );
    }
  }

  /**
   * One-time backfill: apply the auto-confirm to orders that were already stuck
   * in QUOTED ("Por confirmar") before auto-confirm shipped. Runs the same
   * guarded, non-blocking tryAutoConfirmFreeOrder per order, so it only touches
   * qualifying ones (nada que cobrar por tarjeta y, si no es skip_quote,
   * envío en $0) y es seguro re-correrlo (already-confirmed orders are no
   * longer QUOTED, so they're skipped).
   * Invoked from the standalone script src/database/backfill-auto-confirm.ts.
   */
  async backfillAutoConfirmFreeShippingOrders(): Promise<{
    scanned: number;
    confirmed: number;
  }> {
    const quoted = await this.orders.find({
      where: { status: OrderStatus.QUOTED },
    });
    let confirmed = 0;
    for (const o of quoted) {
      await this.tryAutoConfirmFreeOrder(o.id);
      const after = await this.orders.findOne({ where: { id: o.id } });
      if (after?.status === OrderStatus.CONFIRMED_BY_COLMADO) confirmed++;
    }
    this.logger.log(
      `backfill auto-confirm: scanned ${quoted.length} QUOTED orders, confirmed ${confirmed}`,
    );
    return { scanned: quoted.length, confirmed };
  }

  /**
   * Cancel an order and atomically reverse its side-effects: refund applied
   * credit, restore redeemed points, cancel any pending_setup rentals tied to
   * it, and re-increment stock if it had been decremented (confirmed/in-route).
   * Shared by the admin status-change path (updateStatus) and the
   * cancel-non-rental-orders one-time op.
   */
  private async cancelOrderWithReversals(order: Order): Promise<void> {
    const wasStockDecremented =
      order.status === OrderStatus.CONFIRMED_BY_COLMADO ||
      order.status === OrderStatus.IN_DELIVERY_ROUTE;

    await this.dataSource.transaction(async (cancelTx) => {
      await cancelTx
        .getRepository(Order)
        .update(order.id, { status: OrderStatus.CANCELLED });
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

    // Digital orders: release the uncaptured hold right away. Without this the
    // customer's bank sits on the money for ~7 days until the authorization
    // expires on its own. Best-effort epilogue — cancelIntent never throws.
    // The resulting `payment_intent.canceled` webhook is a no-op for a
    // CANCELLED order (handleAuthFailureByIntentId only touches QUOTED /
    // PENDING_VALIDATION).
    if (order.stripePaymentIntentId && !order.paidAt) {
      await this.payments.cancelIntent(order.stripePaymentIntentId);
    }
  }

  /**
   * One-time op: soft-delete (cancel) every order NOT linked to a rental,
   * keeping the rental-triggering orders. Reuses cancelOrderWithReversals so
   * credit / points / stock are properly reversed — never a raw status flip.
   * Already-cancelled orders are skipped (idempotent). With dryRun=true it only
   * reports the breakdown and writes NOTHING. An optional `statuses` filter
   * limits which order statuses are touched. Invoked from the standalone script
   * src/database/cancel-non-rental-orders.ts.
   */
  async cancelNonRentalOrders(opts: {
    dryRun: boolean;
    statuses?: OrderStatus[];
  }): Promise<{
    dryRun: boolean;
    rentalLinkedKept: number;
    candidates: number;
    byStatus: Record<string, number>;
    cancelled: number;
    // Reversal map: every affected order with its status BEFORE cancellation.
    // Save the dry-run output — this is how you'd undo a soft-delete on a Dev
    // Database (no managed backups / point-in-time recovery).
    orders: Array<{ id: string; prevStatus: OrderStatus }>;
  }> {
    const rentalOrderIds = new Set(
      await this.rentalsService.getOrderIdsWithRentals(),
    );
    const all = await this.orders.find();
    const candidates = all.filter(
      (o) =>
        o.status !== OrderStatus.CANCELLED &&
        !rentalOrderIds.has(o.id) &&
        (!opts.statuses || opts.statuses.includes(o.status)),
    );

    const byStatus: Record<string, number> = {};
    const affected: Array<{ id: string; prevStatus: OrderStatus }> = [];
    for (const o of candidates) {
      byStatus[o.status] = (byStatus[o.status] ?? 0) + 1;
      affected.push({ id: o.id, prevStatus: o.status });
    }

    let cancelled = 0;
    if (!opts.dryRun) {
      for (const o of candidates) {
        await this.cancelOrderWithReversals(o);
        cancelled++;
      }
    }

    this.logger.log(
      `cancel-non-rental (${opts.dryRun ? 'DRY RUN' : 'APPLY'}): kept ${
        rentalOrderIds.size
      } rental-linked order id(s); ${candidates.length} candidate(s) ${
        opts.dryRun ? 'would be cancelled' : 'cancelled'
      } — byStatus ${JSON.stringify(byStatus)}`,
    );

    return {
      dryRun: opts.dryRun,
      rentalLinkedKept: rentalOrderIds.size,
      candidates: candidates.length,
      byStatus,
      cancelled,
      orders: affected,
    };
  }

  async updateStatus(
    id: string,
    dto: UpdateOrderStatusDto,
    user: AuthenticatedUser,
  ) {
    const order = await this.findOne(id, user);

    // Idempotent no-op. The driver app advances an order from two places (route
    // list + order detail) and runs on mobile data, so the same PATCH lands
    // twice whenever a response is lost or a screen is a few seconds stale.
    // Returning the order — instead of "Transición inválida: X → X" — keeps
    // that duplicate silent. It must short-circuit BEFORE the side effects
    // below so a re-sent DELIVERED can never capture Stripe, credit points, or
    // issue an invoice a second time. findOne() already scoped the order to
    // this user, so there is nothing here they could not already GET.
    if (order.status === dto.status) return order;

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
      await this.cancelOrderWithReversals(order);
    } else {
      await this.orders.update(id, { status: dto.status });
    }

    const updated = await this.findOne(id, user);
    this.orderNotifications.notifyStatus(updated);
    return updated;
  }

  /**
   * Lleva a ENTREGADA una orden de instalación provisionada por el sistema
   * (el bebedero del suscriptor, el producto exclusivo premium).
   *
   * Existe porque el alquiler NO se activa hasta que la orden se entrega: sin
   * esto la instalación queda esperando que un humano la camine por el flujo, y
   * el contador de mantenimiento nunca arranca. Recorre la máquina de estados
   * en vez de escribir DELIVERED a mano, así corren los efectos reales —
   * activación del alquiler, mantenimiento, factura, puntos y comisiones.
   *
   * GUARDA DURA: solo órdenes de total $0. Este método salta la validación y el
   * cobro; si aceptara órdenes con saldo sería una forma de entregar sin pagar.
   * Devuelve false (sin tirar) cuando no aplica — es un efecto de fondo y no
   * puede tumbar la activación de una suscripción.
   */
  async deliverProvisionedOrder(orderId: string): Promise<boolean> {
    try {
      const order = await this.orders.findOne({ where: { id: orderId } });
      if (!order) return false;
      if (order.status === OrderStatus.DELIVERED) return true; // idempotente

      const totalCents = Math.round(parseFloat(order.totalAmount) * 100);
      if (totalCents !== 0) {
        this.logger.warn(
          `deliverProvisionedOrder: orden ${orderId} no es de $0 (${totalCents}) — se deja en el flujo manual`,
        );
        return false;
      }
      if (order.status !== OrderStatus.CONFIRMED_BY_COLMADO) {
        this.logger.warn(
          `deliverProvisionedOrder: orden ${orderId} está en ${order.status}, se esperaba confirmada — se deja para el reconcile`,
        );
        return false;
      }

      await this.orders.update(orderId, {
        status: OrderStatus.IN_DELIVERY_ROUTE,
      });
      await this.markDelivered(orderId);

      const delivered = await this.orders.findOne({ where: { id: orderId } });
      if (delivered) this.orderNotifications.notifyStatus(delivered);
      return true;
    } catch (err) {
      this.logger.error(
        `deliverProvisionedOrder falló para ${orderId}: ${(err as Error).message}`,
      );
      return false;
    }
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
      // Comisión del vendedor de la cartera. Va en la MISMA transacción que la
      // entrega: si el asiento falla, la orden no queda entregada sin comisión.
      // Es idempotente por (orden, rol), así que un reintento no duplica.
      await this.sellersService.creditCommissionsForOrder(orderId, tx);
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
        (item) => item.product?.isMaintenanceService,
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
    // El vendedor opera los pedidos de su cartera con la misma libertad que el
    // super admin. El límite no es QUÉ transición puede hacer, sino SOBRE QUÉ
    // pedidos llega — y eso ya lo resolvió `findOne` vía `buildScope`.
    if (
      user.role === UserRole.SUPER_ADMIN_DELIVERY ||
      user.role === UserRole.SELLER
    )
      return;

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
