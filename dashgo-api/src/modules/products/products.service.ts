import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import Stripe = require('stripe');
import { Product } from '../../entities';
import { Rental, RentalStatus } from '../../entities/rental.entity';
import { UserRole } from '../../entities/enums';
import { AuthenticatedUser } from '../../common/types/authenticated-user';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { UpdateInventoryDto } from './dto/update-inventory.dto';
import { decorateProduct, ProductWithPricing } from './pricing';

type StripeClient = InstanceType<typeof Stripe>;

export type ProductForClient = Omit<ProductWithPricing, 'imageBytes'>;

@Injectable()
export class ProductsService implements OnModuleInit {
  private readonly logger = new Logger(ProductsService.name);
  private stripe: StripeClient | null = null;

  constructor(
    @InjectRepository(Product)
    private readonly products: Repository<Product>,
    @InjectRepository(Rental)
    private readonly rentals: Repository<Rental>,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    const secret = this.config.get<string>('STRIPE_SECRET_KEY');
    if (!secret) {
      this.logger.warn('STRIPE_SECRET_KEY missing — Stripe rental sync disabled');
      return;
    }
    this.stripe = new Stripe(secret);
  }

  /** Catálogo público — productos disponibles. */
  async findAllPublic(): Promise<ProductForClient[]> {
    const rows = await this.products.find({
      where: { isAvailable: true },
      relations: ['category'],
      order: { createdAt: 'DESC' },
    });
    const now = new Date();
    return rows.map((p) => this.toClient(p, now));
  }

  /** Catálogo editable (super admin) — todos los productos. */
  async findAllForAdmin(user: AuthenticatedUser): Promise<ProductForClient[]> {
    this.assertSuperAdmin(user);
    const rows = await this.products.find({
      relations: ['category'],
      order: { createdAt: 'DESC' },
    });
    const now = new Date();
    return rows.map((p) => this.toClient(p, now));
  }

  async findOne(id: string): Promise<Product> {
    const p = await this.products.findOne({
      where: { id },
      relations: ['category'],
    });
    if (!p) throw new NotFoundException('Producto no encontrado');
    return p;
  }

  async create(
    user: AuthenticatedUser,
    dto: CreateProductDto,
  ): Promise<ProductForClient> {
    this.assertSuperAdmin(user);
    const product = this.products.create({
      name: dto.name,
      description: dto.description ?? null,
      priceToPublic: String(dto.priceToPublic),
      isAvailable: true,
      stock: dto.stock ?? 0,
      promoterCommissionPct:
        dto.promoterCommissionPct !== undefined
          ? String(dto.promoterCommissionPct)
          : '0',
      pointsPct: dto.pointsPct !== undefined ? String(dto.pointsPct) : '1.00',
      categoryId: dto.categoryId ?? null,
      offerLabel: dto.offerLabel ?? null,
      offerDiscountPct:
        dto.offerDiscountPct != null ? String(dto.offerDiscountPct) : null,
      offerStartsAt: dto.offerStartsAt ? new Date(dto.offerStartsAt) : null,
      offerEndsAt: dto.offerEndsAt ? new Date(dto.offerEndsAt) : null,
      pricingMode: dto.pricingMode ?? 'single_payment',
      monthlyRentCents: dto.monthlyRentCents ?? 0,
      lateFeeCents: dto.lateFeeCents ?? 0,
      stripeProductId: dto.stripeProductId ?? null,
      stripePriceId: dto.stripePriceId ?? null,
    });
    const saved = await this.products.save(product);
    const full = await this.findOne(saved.id);
    return this.toClient(full);
  }

  async update(
    id: string,
    user: AuthenticatedUser,
    dto: UpdateProductDto,
  ): Promise<ProductForClient> {
    this.assertSuperAdmin(user);
    const p = await this.findOne(id);

    // Pre-check: block rental → single_payment switch when active rentals exist
    if (dto.pricingMode === 'single_payment' && p.pricingMode === 'rental') {
      const activeRental = await this.rentals.findOne({
        where: {
          productId: id,
          status: In([
            RentalStatus.PENDING_SETUP,
            RentalStatus.ACTIVE,
            RentalStatus.PAST_DUE,
            RentalStatus.UNPAID,
          ]),
        },
      });
      if (activeRental) {
        throw new ConflictException('ACTIVE_RENTALS_EXIST');
      }
    }

    const patch: Partial<Product> = {};
    if (dto.name !== undefined) patch.name = dto.name;
    if (dto.description !== undefined) patch.description = dto.description;
    if (dto.priceToPublic !== undefined)
      patch.priceToPublic = String(dto.priceToPublic);
    if (dto.stock !== undefined) patch.stock = dto.stock;
    if (dto.promoterCommissionPct !== undefined)
      patch.promoterCommissionPct = String(dto.promoterCommissionPct);
    if (dto.pointsPct !== undefined) patch.pointsPct = String(dto.pointsPct);
    if (dto.categoryId !== undefined) patch.categoryId = dto.categoryId;
    if (dto.offerLabel !== undefined) patch.offerLabel = dto.offerLabel;
    if (dto.offerDiscountPct !== undefined) {
      patch.offerDiscountPct =
        dto.offerDiscountPct == null ? null : String(dto.offerDiscountPct);
    }
    if (dto.offerStartsAt !== undefined) {
      patch.offerStartsAt = dto.offerStartsAt
        ? new Date(dto.offerStartsAt)
        : null;
    }
    if (dto.offerEndsAt !== undefined) {
      patch.offerEndsAt = dto.offerEndsAt ? new Date(dto.offerEndsAt) : null;
    }

    // Rental pricing fields
    if (dto.pricingMode !== undefined) patch.pricingMode = dto.pricingMode;
    if (dto.monthlyRentCents !== undefined) patch.monthlyRentCents = dto.monthlyRentCents;
    if (dto.lateFeeCents !== undefined) patch.lateFeeCents = dto.lateFeeCents;
    // Admin-provided Stripe IDs override any auto-sync. When both arrive in the
    // same request, persist them as-is and skip the Stripe API call entirely —
    // operators sometimes create Stripe Products/Prices out-of-band (live mode,
    // CI fixtures, manual mirroring) and the form's `prod_*` / `price_*` Zod
    // validation is meaningless if these get overwritten by auto-create.
    if (dto.stripeProductId !== undefined) patch.stripeProductId = dto.stripeProductId;
    if (dto.stripePriceId !== undefined) patch.stripePriceId = dto.stripePriceId;
    const adminProvidedStripeIds =
      typeof dto.stripeProductId === 'string' &&
      dto.stripeProductId.length > 0 &&
      typeof dto.stripePriceId === 'string' &&
      dto.stripePriceId.length > 0;

    // Determine if Stripe sync is needed before DB update
    const incomingPricingMode = dto.pricingMode ?? p.pricingMode;
    const incomingMonthlyRent = dto.monthlyRentCents ?? p.monthlyRentCents;
    const needsStripeSync =
      incomingPricingMode === 'rental' &&
      incomingMonthlyRent > 0 &&
      (dto.pricingMode === 'rental' || dto.monthlyRentCents !== undefined) &&
      !adminProvidedStripeIds;

    // Perform Stripe sync BEFORE DB write (Stripe-first pattern from ADR-3)
    if (needsStripeSync) {
      // Compute stripe IDs: use incoming patch values or existing ones
      const workingProduct: Product = {
        ...p,
        ...patch,
      } as Product;
      const stripeIds = await this.syncStripeRentalPrice(workingProduct);
      patch.stripeProductId = stripeIds.stripeProductId;
      patch.stripePriceId = stripeIds.stripePriceId;
    }

    if (Object.keys(patch).length > 0) {
      await this.products.update(p.id, patch);
    }
    const full = await this.findOne(id);
    return this.toClient(full);
  }

  async remove(
    id: string,
    user: AuthenticatedUser,
  ): Promise<{ deleted: true }> {
    this.assertSuperAdmin(user);
    const p = await this.findOne(id);
    await this.products.remove(p);
    return { deleted: true };
  }

  /** Actualiza disponibilidad / stock del producto global. */
  async updateInventory(
    id: string,
    dto: UpdateInventoryDto,
    user: AuthenticatedUser,
  ): Promise<ProductForClient> {
    this.assertSuperAdmin(user);
    const p = await this.findOne(id);
    const patch: Partial<Product> = {};
    if (dto.isAvailable !== undefined) patch.isAvailable = dto.isAvailable;
    if (dto.stock !== undefined) patch.stock = dto.stock;
    if (Object.keys(patch).length > 0) {
      await this.products.update(p.id, patch);
    }
    const full = await this.findOne(id);
    return this.toClient(full);
  }

  async uploadImage(
    id: string,
    user: AuthenticatedUser,
    file: { buffer: Buffer; mimetype: string; size: number },
  ): Promise<ProductForClient> {
    this.assertSuperAdmin(user);
    if (!file) throw new BadRequestException('Archivo requerido');
    if (!file.mimetype.startsWith('image/')) {
      throw new BadRequestException('El archivo debe ser una imagen');
    }
    if (file.size > 5 * 1024 * 1024) {
      throw new BadRequestException('Imagen excede 5MB');
    }
    const p = await this.findOne(id);
    await this.products.update(p.id, {
      imageBytes: file.buffer,
      imageContentType: file.mimetype,
      imageUpdatedAt: new Date(),
    });
    const full = await this.findOne(id);
    return this.toClient(full);
  }

  async getImage(
    id: string,
  ): Promise<{ buffer: Buffer; contentType: string; updatedAt: Date | null }> {
    const row = await this.products
      .createQueryBuilder('p')
      .addSelect('p.image_bytes', 'p_image_bytes')
      .where('p.id = :id', { id })
      .getRawAndEntities();
    if (!row.entities[0]) throw new NotFoundException('Producto no encontrado');
    const bytes: Buffer | null = row.raw[0]?.p_image_bytes ?? null;
    const contentType = row.entities[0].imageContentType;
    if (!bytes || !contentType) {
      throw new NotFoundException('Producto sin imagen');
    }
    return {
      buffer: bytes,
      contentType,
      updatedAt: row.entities[0].imageUpdatedAt,
    };
  }

  /**
   * Syncs Stripe Product + Price for a rental product.
   *
   * 4-step rotation pattern (mirrors SubscriptionService.updatePlan / ADR-3):
   *   1. Create Stripe Product if none exists
   *   2. Create new Stripe Price (always — we always issue a fresh price)
   *   3. Set new Price as default_price on Stripe Product
   *   4. Archive old Price (NON-BLOCKING — log warn but continue)
   *
   * Returns the new { stripeProductId, stripePriceId } to persist in DB.
   */
  private async syncStripeRentalPrice(
    product: Product,
  ): Promise<{ stripeProductId: string; stripePriceId: string }> {
    const stripe = this.requireStripe();
    let stripeProductId = product.stripeProductId;
    const oldPriceId = product.stripePriceId;

    // Step 1: create Stripe Product if not yet created
    if (!stripeProductId) {
      let stripeProduct: { id: string };
      try {
        stripeProduct = await stripe.products.create(
          { name: product.name, metadata: { productId: product.id } },
          { idempotencyKey: `product-rental:${product.id}` },
        );
      } catch (e) {
        this.logger.error(
          `syncStripeRentalPrice: stripe.products.create failed for product ${product.id}: ${(e as Error).message}`,
        );
        throw new HttpException(
          {
            statusCode: 502,
            code: 'STRIPE_PRODUCT_CREATE_FAILED',
            message: 'Stripe product creation failed',
          },
          HttpStatus.BAD_GATEWAY,
        );
      }
      stripeProductId = stripeProduct.id;
    }

    // Step 2: create new Stripe Price
    let newPrice: { id: string };
    try {
      newPrice = await stripe.prices.create(
        {
          unit_amount: product.monthlyRentCents,
          currency: 'usd',
          recurring: { interval: 'month' },
          product: stripeProductId,
        },
        {
          idempotencyKey: `product-rental-price:${product.id}:${product.monthlyRentCents}:${Date.now()}`,
        },
      );
    } catch (e) {
      this.logger.error(
        `syncStripeRentalPrice: stripe.prices.create failed for product ${product.id}: ${(e as Error).message}`,
      );
      throw new HttpException(
        {
          statusCode: 502,
          code: 'STRIPE_PRICE_CREATE_FAILED',
          message: 'Stripe price creation failed',
        },
        HttpStatus.BAD_GATEWAY,
      );
    }

    // Step 3: set new Price as default_price on Stripe Product
    try {
      await stripe.products.update(stripeProductId, {
        default_price: newPrice.id,
      });
    } catch (e) {
      this.logger.warn(
        `syncStripeRentalPrice: stripe.products.update(default_price) failed (non-blocking): ${(e as Error).message}`,
      );
      // Non-blocking: product default_price is cosmetic; subscriptions use items[].price
    }

    // Step 4: archive old Price (NON-BLOCKING)
    if (oldPriceId) {
      try {
        await stripe.prices.update(oldPriceId, { active: false });
      } catch (e) {
        this.logger.warn(
          `syncStripeRentalPrice: archive of old price ${oldPriceId} failed (non-blocking): ${(e as Error).message}`,
        );
        // proceed
      }
    }

    return { stripeProductId, stripePriceId: newPrice.id };
  }

  private toClient(p: Product, now: Date = new Date()): ProductForClient {
    const decorated = decorateProduct(p, now);
    const { imageBytes, ...rest } = decorated;
    void imageBytes;
    return rest;
  }

  private assertSuperAdmin(user: AuthenticatedUser) {
    if (user.role !== UserRole.SUPER_ADMIN_DELIVERY) {
      throw new ForbiddenException('Solo super admin puede gestionar productos');
    }
  }

  private requireStripe(): StripeClient {
    if (!this.stripe) {
      throw new HttpException(
        {
          statusCode: 503,
          code: 'STRIPE_NOT_CONFIGURED',
          message: 'Stripe no está configurado en este entorno',
        },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    return this.stripe;
  }
}
