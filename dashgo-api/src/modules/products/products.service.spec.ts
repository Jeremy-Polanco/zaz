/**
 * Unit specs for ProductsService.
 *
 * Stripe is mocked at module level. Repositories and ConfigService are
 * injected as jest mocks. No real DB or Stripe connection.
 */

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { ProductsService } from './products.service';
import { Product } from '../../entities/product.entity';
import { Rental, RentalStatus } from '../../entities/rental.entity';
import { UserRole } from '../../entities/enums';
import { AuthenticatedUser } from '../../common/types/authenticated-user';
import { createMockStripe, MockStripe } from '../../test-utils/stripe';

// ---------------------------------------------------------------------------
// Module-level Stripe mock
// ---------------------------------------------------------------------------
jest.mock('stripe', () => {
  const mock = jest.fn().mockImplementation(() => mockStripeInstance);
  (mock as unknown as Record<string, unknown>)['default'] = mock;
  return mock;
});

let mockStripeInstance: MockStripe;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRepoMock<T>(): jest.Mocked<Repository<T>> {
  return {
    findOne: jest.fn(),
    find: jest.fn(),
    save: jest.fn(),
    update: jest.fn(),
    create: jest.fn((dto: Partial<T>) => dto as T),
    upsert: jest.fn(),
    createQueryBuilder: jest.fn(),
    count: jest.fn(),
    delete: jest.fn(),
    remove: jest.fn(),
    manager: { transaction: jest.fn() },
  } as unknown as jest.Mocked<Repository<T>>;
}

const superAdmin: AuthenticatedUser = {
  id: 'user-admin-1',
  role: UserRole.SUPER_ADMIN_DELIVERY,
  email: 'admin@test.com',
};

function fakeProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: 'product-1',
    name: 'Test Product',
    description: null,
    priceToPublic: '100.00',
    isAvailable: true,
    stock: 10,
    imageBytes: null,
    imageContentType: null,
    imageUpdatedAt: null,
    promoterCommissionPct: '0',
    pointsPct: '1.00',
    categoryId: null,
    category: null,
    offerLabel: null,
    offerDiscountPct: null,
    offerStartsAt: null,
    offerEndsAt: null,
    pricingMode: 'single_payment',
    monthlyRentCents: 0,
    lateFeeCents: 0,
    stripeProductId: null,
    stripePriceId: null,
    displayOrder: 0,
    createdAt: new Date(),
    ...overrides,
  } as Product;
}

function fakeRental(overrides: Partial<Rental> = {}): Rental {
  return {
    id: 'rental-1',
    userId: 'user-1',
    productId: 'product-1',
    orderId: 'order-1',
    stripeSubscriptionId: 'sub_abc',
    stripePriceId: 'price_OLD',
    status: RentalStatus.ACTIVE,
    monthlyRentCents: 2000,
    lateFeeCents: 500,
    currentPeriodStart: new Date(),
    currentPeriodEnd: new Date(Date.now() + 30 * 86400 * 1000),
    activatedAt: new Date(),
    canceledAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    user: {} as never,
    product: {} as never,
    order: {} as never,
    ...overrides,
  } as Rental;
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('ProductsService', () => {
  let service: ProductsService;
  let productsRepo: jest.Mocked<Repository<Product>>;
  let rentalsRepo: jest.Mocked<Repository<Rental>>;

  beforeEach(async () => {
    mockStripeInstance = createMockStripe();

    productsRepo = makeRepoMock<Product>();
    rentalsRepo = makeRepoMock<Rental>();

    const configService = {
      get: jest.fn((key: string) => {
        if (key === 'STRIPE_SECRET_KEY') return 'sk_test_fake';
        return undefined;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductsService,
        { provide: getRepositoryToken(Product), useValue: productsRepo },
        { provide: getRepositoryToken(Rental), useValue: rentalsRepo },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    await module.init();
    service = module.get<ProductsService>(ProductsService);
  });

  // -------------------------------------------------------------------------
  // Pair 1 (T13/T14): First rental save — no existing Stripe IDs
  // -------------------------------------------------------------------------

  describe('update: first rental mode save (pricingMode single_payment → rental)', () => {
    it('should create Stripe Product + Price and persist IDs', async () => {
      const product = fakeProduct({
        id: 'product-1',
        name: 'Water Dispenser',
        pricingMode: 'single_payment',
        stripeProductId: null,
        stripePriceId: null,
      });

      // findOne used for pre-check AND reload
      productsRepo.findOne
        .mockResolvedValueOnce(product) // initial findOne in update()
        .mockResolvedValueOnce({
          ...product,
          pricingMode: 'rental',
          monthlyRentCents: 2000,
          stripeProductId: 'prod_NEW',
          stripePriceId: 'price_NEW',
        }); // reload after update

      productsRepo.update.mockResolvedValue({
        affected: 1,
        raw: [],
        generatedMaps: [],
      });

      mockStripeInstance.products.create = jest
        .fn()
        .mockResolvedValue({ id: 'prod_NEW' });
      mockStripeInstance.prices.create.mockResolvedValueOnce({
        id: 'price_NEW',
        unit_amount: 2000,
      });
      mockStripeInstance.products.update.mockResolvedValue({});

      await service.update('product-1', superAdmin, {
        pricingMode: 'rental',
        monthlyRentCents: 2000,
      });

      // Assert Stripe Product created with product name
      expect(mockStripeInstance.products.create).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Water Dispenser' }),
        expect.objectContaining({
          idempotencyKey: expect.stringContaining('product-1'),
        }),
      );

      // Assert Stripe Price created with correct params
      expect(mockStripeInstance.prices.create).toHaveBeenCalledWith(
        expect.objectContaining({
          unit_amount: 2000,
          currency: 'usd',
          recurring: { interval: 'month' },
          product: 'prod_NEW',
        }),
        expect.objectContaining({
          idempotencyKey: expect.stringContaining('product-1'),
        }),
      );

      // Assert DB updated with stripe IDs
      expect(productsRepo.update).toHaveBeenCalledWith(
        'product-1',
        expect.objectContaining({
          pricingMode: 'rental',
          monthlyRentCents: 2000,
          stripeProductId: 'prod_NEW',
          stripePriceId: 'price_NEW',
        }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // Pair 2 (T15/T16): Price rotation — monthlyRentCents changes on existing rental product
  // -------------------------------------------------------------------------

  describe('update: price rotation when monthlyRentCents changes on existing rental', () => {
    it('should create new Price, archive old Price, and update stripePriceId', async () => {
      const product = fakeProduct({
        id: 'product-1',
        name: 'Water Dispenser',
        pricingMode: 'rental',
        monthlyRentCents: 2000,
        stripeProductId: 'prod_X',
        stripePriceId: 'price_OLD',
      });

      productsRepo.findOne
        .mockResolvedValueOnce(product) // initial findOne
        .mockResolvedValueOnce({
          ...product,
          monthlyRentCents: 2500,
          stripePriceId: 'price_NEW_25',
        }); // reload

      productsRepo.update.mockResolvedValue({
        affected: 1,
        raw: [],
        generatedMaps: [],
      });

      mockStripeInstance.prices.create.mockResolvedValueOnce({
        id: 'price_NEW_25',
        unit_amount: 2500,
      });
      mockStripeInstance.products.update.mockResolvedValue({});
      mockStripeInstance.prices.update.mockResolvedValue({});

      await service.update('product-1', superAdmin, {
        monthlyRentCents: 2500,
      });

      // Assert new Price created at $25
      expect(mockStripeInstance.prices.create).toHaveBeenCalledWith(
        expect.objectContaining({
          unit_amount: 2500,
          currency: 'usd',
          recurring: { interval: 'month' },
          product: 'prod_X',
        }),
        expect.any(Object),
      );

      // Assert old Price archived
      expect(mockStripeInstance.prices.update).toHaveBeenCalledWith(
        'price_OLD',
        { active: false },
      );

      // Assert DB updated with new stripePriceId and stripeProductId preserved
      expect(productsRepo.update).toHaveBeenCalledWith(
        'product-1',
        expect.objectContaining({
          monthlyRentCents: 2500,
          stripePriceId: 'price_NEW_25',
          stripeProductId: 'prod_X', // preserved — NOT a new Stripe Product
        }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // Pair 3 (T17/T18): Blocked switch rental → single_payment when active rentals exist
  // -------------------------------------------------------------------------

  describe('update: switch rental → single_payment blocked by active rentals', () => {
    it('should throw ConflictException 409 when active rentals exist', async () => {
      const product = fakeProduct({
        id: 'product-1',
        pricingMode: 'rental',
        monthlyRentCents: 2000,
        stripeProductId: 'prod_X',
        stripePriceId: 'price_OLD',
      });

      productsRepo.findOne.mockResolvedValueOnce(product);

      // Mock rentals repo to return an active rental
      rentalsRepo.findOne.mockResolvedValueOnce(
        fakeRental({ status: RentalStatus.ACTIVE }),
      );

      await expect(
        service.update('product-1', superAdmin, {
          pricingMode: 'single_payment',
        }),
      ).rejects.toThrow(ConflictException);

      // Stripe must NOT be called
      expect(mockStripeInstance.prices.create).not.toHaveBeenCalled();
      expect(mockStripeInstance.products.create).not.toHaveBeenCalled();

      // DB must NOT be updated
      expect(productsRepo.update).not.toHaveBeenCalled();
    });

    it('should succeed if no active rentals exist', async () => {
      const product = fakeProduct({
        id: 'product-1',
        pricingMode: 'rental',
        monthlyRentCents: 2000,
        stripeProductId: 'prod_X',
        stripePriceId: 'price_OLD',
      });

      productsRepo.findOne
        .mockResolvedValueOnce(product)
        .mockResolvedValueOnce({
          ...product,
          pricingMode: 'single_payment',
        });

      // No active rentals
      rentalsRepo.findOne.mockResolvedValueOnce(null);
      productsRepo.update.mockResolvedValue({
        affected: 1,
        raw: [],
        generatedMaps: [],
      });

      const result = await service.update('product-1', superAdmin, {
        pricingMode: 'single_payment',
      });

      expect(result).toBeDefined();
      expect(productsRepo.update).toHaveBeenCalledWith(
        'product-1',
        expect.objectContaining({ pricingMode: 'single_payment' }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // Existing guard tests
  // -------------------------------------------------------------------------

  describe('findOne', () => {
    it('should throw NotFoundException when product not found', async () => {
      productsRepo.findOne.mockResolvedValueOnce(null);
      await expect(service.findOne('not-found')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // -------------------------------------------------------------------------
  // BUG-1 fix: create() must persist rental fields
  // -------------------------------------------------------------------------

  describe('create: rental fields are persisted', () => {
    it('should pass pricingMode + monthlyRentCents + lateFeeCents + stripe IDs to repo.create when provided in DTO', async () => {
      const captured = fakeProduct({
        id: 'new-1',
        pricingMode: 'rental',
        monthlyRentCents: 1500,
        lateFeeCents: 500,
        stripeProductId: 'prod_admin123',
        stripePriceId: 'price_admin456',
      });
      productsRepo.create.mockReturnValueOnce(captured);
      productsRepo.save.mockResolvedValueOnce(captured);
      productsRepo.findOne.mockResolvedValueOnce(captured);

      const result = await service.create(superAdmin, {
        name: 'Dispenser',
        priceToPublic: 0,
        stock: 10,
        pricingMode: 'rental',
        monthlyRentCents: 1500,
        lateFeeCents: 500,
        stripeProductId: 'prod_admin123',
        stripePriceId: 'price_admin456',
      } as never);

      expect(productsRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          pricingMode: 'rental',
          monthlyRentCents: 1500,
          lateFeeCents: 500,
          stripeProductId: 'prod_admin123',
          stripePriceId: 'price_admin456',
        }),
      );
      expect(result.pricingMode).toBe('rental');
      expect(result.monthlyRentCents).toBe(1500);
    });

    it('should default pricingMode to single_payment + zero rental amounts when not provided', async () => {
      const captured = fakeProduct({ id: 'new-2' });
      productsRepo.create.mockReturnValueOnce(captured);
      productsRepo.save.mockResolvedValueOnce(captured);
      productsRepo.findOne.mockResolvedValueOnce(captured);

      await service.create(superAdmin, {
        name: 'Botellón',
        priceToPublic: 5,
        stock: 20,
      });

      expect(productsRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          pricingMode: 'single_payment',
          monthlyRentCents: 0,
          lateFeeCents: 0,
          stripeProductId: null,
          stripePriceId: null,
        }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // BUG-2 fix: admin-provided Stripe IDs short-circuit auto-sync
  // -------------------------------------------------------------------------

  describe('update: admin-provided Stripe IDs skip syncStripeRentalPrice', () => {
    it('should NOT call Stripe when both stripeProductId AND stripePriceId are provided', async () => {
      const product = fakeProduct({
        pricingMode: 'single_payment',
        monthlyRentCents: 0,
      });
      productsRepo.findOne
        .mockResolvedValueOnce(product)
        .mockResolvedValueOnce({
          ...product,
          pricingMode: 'rental',
          monthlyRentCents: 1500,
          stripeProductId: 'prod_admin999',
          stripePriceId: 'price_admin999',
        });

      await service.update('product-1', superAdmin, {
        pricingMode: 'rental',
        monthlyRentCents: 1500,
        stripeProductId: 'prod_admin999',
        stripePriceId: 'price_admin999',
      });

      expect(mockStripeInstance.products.create).not.toHaveBeenCalled();
      expect(mockStripeInstance.prices.create).not.toHaveBeenCalled();
      expect(productsRepo.update).toHaveBeenCalledWith(
        'product-1',
        expect.objectContaining({
          stripeProductId: 'prod_admin999',
          stripePriceId: 'price_admin999',
        }),
      );
    });
  });

  describe('update: permission guard', () => {
    it('should throw ForbiddenException when called by non-super-admin', async () => {
      const regularUser: AuthenticatedUser = {
        id: 'user-2',
        role: 'client' as never,
        email: 'client@test.com',
      };
      await expect(
        service.update('product-1', regularUser, { name: 'Hack' }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // -------------------------------------------------------------------------
  // Catalog ordering (display_order)
  // -------------------------------------------------------------------------

  describe('catalog ordering by displayOrder', () => {
    it('findAllPublic orders by displayOrder ASC then createdAt DESC', async () => {
      productsRepo.find.mockResolvedValueOnce([]);
      await service.findAllPublic();
      expect(productsRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          order: { displayOrder: 'ASC', createdAt: 'DESC' },
        }),
      );
    });

    it('findAllForAdmin orders by displayOrder ASC then createdAt DESC', async () => {
      productsRepo.find.mockResolvedValueOnce([]);
      await service.findAllForAdmin(superAdmin);
      expect(productsRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          order: { displayOrder: 'ASC', createdAt: 'DESC' },
        }),
      );
    });

    it('create persists a provided displayOrder and defaults to 0', async () => {
      const captured = fakeProduct({ id: 'new-3', displayOrder: 5 });
      productsRepo.create.mockReturnValueOnce(captured);
      productsRepo.save.mockResolvedValueOnce(captured);
      productsRepo.findOne.mockResolvedValueOnce(captured);

      await service.create(superAdmin, {
        name: 'Botellón',
        priceToPublic: 5,
        displayOrder: 5,
      });

      expect(productsRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ displayOrder: 5 }),
      );

      const capturedDefault = fakeProduct({ id: 'new-4' });
      productsRepo.create.mockReturnValueOnce(capturedDefault);
      productsRepo.save.mockResolvedValueOnce(capturedDefault);
      productsRepo.findOne.mockResolvedValueOnce(capturedDefault);

      await service.create(superAdmin, {
        name: 'Botellón',
        priceToPublic: 5,
      });

      expect(productsRepo.create).toHaveBeenLastCalledWith(
        expect.objectContaining({ displayOrder: 0 }),
      );
    });

    it('update persists displayOrder', async () => {
      const product = fakeProduct();
      productsRepo.findOne
        .mockResolvedValueOnce(product)
        .mockResolvedValueOnce({ ...product, displayOrder: 7 });
      productsRepo.update.mockResolvedValue({
        affected: 1,
        raw: [],
        generatedMaps: [],
      });

      await service.update('product-1', superAdmin, { displayOrder: 7 });

      expect(productsRepo.update).toHaveBeenCalledWith(
        'product-1',
        expect.objectContaining({ displayOrder: 7 }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // Bulk reorder (drag & drop)
  // -------------------------------------------------------------------------

  describe('reorder', () => {
    const items = [
      { id: 'id-a', displayOrder: 0 },
      { id: 'id-b', displayOrder: 1 },
    ];

    it('updates every product inside a transaction and returns the count', async () => {
      productsRepo.find.mockResolvedValueOnce([
        { id: 'id-a' },
        { id: 'id-b' },
      ] as Product[]);
      const emUpdate = jest.fn();
      (productsRepo.manager.transaction as jest.Mock).mockImplementation(
        async (cb: (em: { update: jest.Mock }) => Promise<void>) =>
          cb({ update: emUpdate }),
      );

      const result = await service.reorder(superAdmin, { items });

      expect(result).toEqual({ updated: 2 });
      expect(emUpdate).toHaveBeenCalledWith(Product, 'id-a', {
        displayOrder: 0,
      });
      expect(emUpdate).toHaveBeenCalledWith(Product, 'id-b', {
        displayOrder: 1,
      });
    });

    it('throws NotFoundException when an id does not exist', async () => {
      productsRepo.find.mockResolvedValueOnce([{ id: 'id-a' }] as Product[]);

      await expect(service.reorder(superAdmin, { items })).rejects.toThrow(
        NotFoundException,
      );
      expect(productsRepo.manager.transaction).not.toHaveBeenCalled();
    });

    it('throws BadRequestException on duplicate ids', async () => {
      await expect(
        service.reorder(superAdmin, {
          items: [
            { id: 'id-a', displayOrder: 0 },
            { id: 'id-a', displayOrder: 1 },
          ],
        }),
      ).rejects.toThrow(BadRequestException);
      expect(productsRepo.manager.transaction).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException for non-super-admin', async () => {
      const regularUser: AuthenticatedUser = {
        id: 'user-2',
        role: 'client' as never,
        email: 'client@test.com',
      };
      await expect(service.reorder(regularUser, { items })).rejects.toThrow(
        ForbiddenException,
      );
    });
  });
});
