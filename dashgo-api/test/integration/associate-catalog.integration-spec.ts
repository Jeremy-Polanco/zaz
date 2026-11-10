/**
 * Integration spec — catálogo mayorista del asociado, de punta a punta por HTTP.
 *
 * POR QUÉ real: el catálogo, el cobro y la suscripción del asociado cruzan
 * controladores, guards (JWT opcional en GET /products), servicios, migraciones
 * (columnas associate_price_cents / associate_pricing) y el libro de saldo.
 * Los unit specs mockean cada capa; solo la API real prueba que el precio
 * mayorista no se filtra a nadie más y que el intent de Stripe y la orden
 * cobran lo mismo. La base se comparte con el resto de los specs: se asierta
 * por ids y se limpia todo en afterAll.
 */

// eslint-disable-next-line no-var
var mockStripe: {
  paymentIntents: { create: jest.Mock; retrieve: jest.Mock; cancel: jest.Mock; capture: jest.Mock };
  customers: { create: jest.Mock; search: jest.Mock; update: jest.Mock; list: jest.Mock };
  subscriptions: { create: jest.Mock; retrieve: jest.Mock; update: jest.Mock; list: jest.Mock };
  checkout: { sessions: { create: jest.Mock } };
  billingPortal: { sessions: { create: jest.Mock } };
  webhooks: { constructEvent: jest.Mock };
  prices: { retrieve: jest.Mock; create: jest.Mock; update: jest.Mock };
  products: { create: jest.Mock; update: jest.Mock };
};

jest.mock('stripe', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ctor = jest.fn().mockImplementation(() => mockStripe as any);
  return ctor;
});

mockStripe = {
  paymentIntents: {
    create: jest.fn(),
    retrieve: jest.fn(),
    cancel: jest.fn(),
    capture: jest.fn(),
  },
  customers: { create: jest.fn(), search: jest.fn(), update: jest.fn(), list: jest.fn() },
  subscriptions: { create: jest.fn(), retrieve: jest.fn(), update: jest.fn(), list: jest.fn() },
  checkout: { sessions: { create: jest.fn() } },
  billingPortal: { sessions: { create: jest.fn() } },
  webhooks: { constructEvent: jest.fn() },
  prices: { retrieve: jest.fn(), create: jest.fn(), update: jest.fn() },
  products: { create: jest.fn(), update: jest.fn() },
};

import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { createTestingApp } from '../../src/test-utils/testing-app';
import { makeUser } from '../../src/test-utils/fixtures';
import { issueTestToken } from '../e2e/helpers/auth.helper';
import {
  AssociateBalanceEntry,
  AssociateBalanceEntryType,
  Category,
  Order,
  Product,
  User,
} from '../../src/entities';
import { PaymentMethod, UserRole } from '../../src/entities/enums';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const request = require('supertest') as typeof import('supertest');

describe('Catálogo mayorista del asociado por HTTP (integración)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let category: Category;
  let listed: Product; // tiene precio de asociado (600) y público 10.00
  let unlisted: Product; // sin precio de asociado
  const userIds: string[] = [];
  const productIds: string[] = [];

  const LISTED_PUBLIC_CENTS = 1000;
  const LISTED_ASSOCIATE_CENTS = 600;
  const address = { text: 'Assoc Catalog St', lat: 40.7, lng: -74.0 };

  beforeAll(async () => {
    app = await createTestingApp();
    ds = app.get(DataSource);

    const stamp = `${process.pid}-${Date.now()}`;
    category = await ds.getRepository(Category).save(
      ds.getRepository(Category).create({
        name: `assoc-catalog-${stamp}`,
        slug: `assoc-catalog-${stamp}`,
        displayOrder: 999,
      }),
    );
    const repo = ds.getRepository(Product);
    // requiresQuote=false: la orden se auto-cotiza con impuesto, así su
    // totalAmount es comparable con el monto del intent de Stripe.
    listed = await repo.save(
      repo.create({
        name: `assoc-catalog-listed-${stamp}`,
        priceToPublic: '10.00',
        associatePriceCents: LISTED_ASSOCIATE_CENTS,
        stock: 100,
        requiresQuote: false,
        categoryId: category.id,
      } as Partial<Product>),
    );
    unlisted = await repo.save(
      repo.create({
        name: `assoc-catalog-unlisted-${stamp}`,
        priceToPublic: '5.00',
        stock: 100,
        requiresQuote: false,
        categoryId: category.id,
      } as Partial<Product>),
    );
    productIds.push(listed.id, unlisted.id);
  });

  afterAll(async () => {
    if (ds?.isInitialized) {
      if (userIds.length) {
        await ds.query(
          'DELETE FROM associate_balance_entries WHERE user_id = ANY($1)',
          [userIds],
        );
        await ds.query(
          'DELETE FROM pool_contributions WHERE source_user_id = ANY($1)',
          [userIds],
        );
        await ds.query('DELETE FROM orders WHERE customer_id = ANY($1)', [
          userIds,
        ]);
        await ds.getRepository(User).delete(userIds);
      }
      if (productIds.length) {
        await ds.getRepository(Product).delete(productIds);
      }
      if (category) await ds.getRepository(Category).delete(category.id);
    }
    if (app) await app.close();
  });

  beforeEach(() => {
    mockStripe.paymentIntents.create.mockReset();
    mockStripe.paymentIntents.create.mockImplementation(
      async (params: { amount: number }) => ({
        id: `pi_assoc_catalog_${Math.random().toString(36).slice(2)}`,
        client_secret: 'cs_test',
        amount: params.amount,
      }),
    );
  });

  async function seedUser(role: UserRole): Promise<User> {
    const user = await ds
      .getRepository(User)
      .save(ds.getRepository(User).create(makeUser({ role }) as Partial<User>));
    userIds.push(user.id);
    return user;
  }

  async function seedAssociate(cents: number): Promise<User> {
    const user = await seedUser(UserRole.ASSOCIATE);
    if (cents > 0) {
      await ds.getRepository(AssociateBalanceEntry).save(
        ds.getRepository(AssociateBalanceEntry).create({
          userId: user.id,
          type: AssociateBalanceEntryType.ALLOCATION,
          amountCents: cents,
          distributionId: null,
        }),
      );
    }
    return user;
  }

  const bearer = async (user: User) =>
    `Bearer ${await issueTestToken(app, user.id, user.role)}`;

  type CatalogItem = {
    id: string;
    effectivePriceCents: number;
    associatePriceCents?: number;
  };

  describe('GET /products', () => {
    it('un invitado ve ambos productos y nunca associatePriceCents', async () => {
      const res = await request(app.getHttpServer())
        .get('/products')
        .expect(200);
      const items = res.body as CatalogItem[];

      for (const item of items) {
        expect(item).not.toHaveProperty('associatePriceCents');
      }
      const l = items.find((p) => p.id === listed.id);
      expect(l?.effectivePriceCents).toBe(LISTED_PUBLIC_CENTS);
      expect(items.some((p) => p.id === unlisted.id)).toBe(true);
    });

    it('un cliente ve ambos productos a precio público y sin associatePriceCents', async () => {
      const client = await seedUser(UserRole.CLIENT);
      const res = await request(app.getHttpServer())
        .get('/products')
        .set('Authorization', await bearer(client))
        .expect(200);
      const items = res.body as CatalogItem[];

      for (const item of items) {
        expect(item).not.toHaveProperty('associatePriceCents');
      }
      expect(items.find((p) => p.id === listed.id)?.effectivePriceCents).toBe(
        LISTED_PUBLIC_CENTS,
      );
      expect(items.some((p) => p.id === unlisted.id)).toBe(true);
    });

    it('un asociado ve solo el producto con precio, a su precio, sin associatePriceCents', async () => {
      const assoc = await seedAssociate(0);
      const res = await request(app.getHttpServer())
        .get('/products')
        .set('Authorization', await bearer(assoc))
        .expect(200);
      const items = res.body as CatalogItem[];

      for (const item of items) {
        expect(item).not.toHaveProperty('associatePriceCents');
      }
      expect(items.some((p) => p.id === unlisted.id)).toBe(false);
      expect(items.find((p) => p.id === listed.id)?.effectivePriceCents).toBe(
        LISTED_ASSOCIATE_CENTS,
      );
    });
  });

  describe('POST /orders como asociado', () => {
    it('un producto sin precio de asociado responde 400 y no escribe ninguna orden', async () => {
      const assoc = await seedAssociate(1000);

      const res = await request(app.getHttpServer())
        .post('/orders')
        .set('Authorization', await bearer(assoc))
        .send({
          items: [{ productId: unlisted.id, quantity: 1 }],
          paymentMethod: PaymentMethod.CASH,
          deliveryAddress: address,
        })
        .expect(400);

      expect(res.body.code).toBe('PRODUCT_NOT_AVAILABLE_FOR_ASSOCIATES');
      expect(res.body.message).toBe(
        'Este producto no está disponible para asociados',
      );
      expect(
        await ds.getRepository(Order).count({ where: { customerId: assoc.id } }),
      ).toBe(0);
    });

    it('un carrito mixto (con un producto sin precio) también se rechaza entero', async () => {
      const assoc = await seedAssociate(0);

      const res = await request(app.getHttpServer())
        .post('/orders')
        .set('Authorization', await bearer(assoc))
        .send({
          items: [
            { productId: listed.id, quantity: 1 },
            { productId: unlisted.id, quantity: 1 },
          ],
          paymentMethod: PaymentMethod.CASH,
          deliveryAddress: address,
        })
        .expect(400);

      expect(res.body.code).toBe('PRODUCT_NOT_AVAILABLE_FOR_ASSOCIATES');
      expect(
        await ds.getRepository(Order).count({ where: { customerId: assoc.id } }),
      ).toBe(0);
    });

    it('POST /payments/intent con un producto sin precio también responde 400 antes de tocar Stripe', async () => {
      const assoc = await seedAssociate(0);

      const res = await request(app.getHttpServer())
        .post('/payments/intent')
        .set('Authorization', await bearer(assoc))
        .send({
          items: [{ productId: unlisted.id, quantity: 1 }],
          deliveryAddress: address,
        })
        .expect(400);

      expect(res.body.code).toBe('PRODUCT_NOT_AVAILABLE_FOR_ASSOCIATES');
      expect(mockStripe.paymentIntents.create).not.toHaveBeenCalled();
    });
  });

  describe('paridad intent ↔ orden con saldo de asociado', () => {
    it('el monto del intent de Stripe es igual al total de la orden y la orden queda con associate_pricing', async () => {
      // Saldo (200) menor que el subtotal mayorista (2 × 600 = 1200): se gasta
      // todo el saldo y el resto lo cobra la tarjeta.
      const assoc = await seedAssociate(200);
      const auth = await bearer(assoc);
      const items = [{ productId: listed.id, quantity: 2 }];

      const intentRes = await request(app.getHttpServer())
        .post('/payments/intent')
        .set('Authorization', auth)
        .send({ items, usePoints: true, deliveryAddress: address })
        .expect(201);

      expect(mockStripe.paymentIntents.create).toHaveBeenCalledTimes(1);
      const stripeAmount = (
        mockStripe.paymentIntents.create.mock.calls[0][0] as { amount: number }
      ).amount;
      expect(intentRes.body.amount).toBe(stripeAmount);

      const orderRes = await request(app.getHttpServer())
        .post('/orders')
        .set('Authorization', auth)
        .send({
          items,
          usePoints: true,
          paymentMethod: PaymentMethod.DIGITAL,
          stripePaymentIntentId: intentRes.body.paymentIntentId,
          deliveryAddress: address,
        })
        .expect(201);

      const row = await ds
        .getRepository(Order)
        .findOneByOrFail({ id: orderRes.body.id });
      expect(row.customerId).toBe(assoc.id);
      expect(row.associatePricing).toBe(true);
      expect(row.subtotal).toBe('12.00'); // 2 × 6.00 mayorista, no 2 × 10.00
      expect(row.pointsRedeemed).toBe('2.00');

      // El Stripe mock recibió EXACTAMENTE lo que la orden registra.
      expect(Math.round(parseFloat(row.totalAmount) * 100)).toBe(stripeAmount);
    });

    it('el saldo no se cobra de más: con saldo mayor al subtotal solo se gasta el subtotal', async () => {
      const assoc = await seedAssociate(5000);
      const auth = await bearer(assoc);
      const items = [{ productId: listed.id, quantity: 1 }];

      const intentRes = await request(app.getHttpServer())
        .post('/payments/intent')
        .set('Authorization', auth)
        .send({ items, usePoints: true, deliveryAddress: address })
        .expect(201);
      const stripeAmount = (
        mockStripe.paymentIntents.create.mock.calls[0][0] as { amount: number }
      ).amount;

      const orderRes = await request(app.getHttpServer())
        .post('/orders')
        .set('Authorization', auth)
        .send({
          items,
          usePoints: true,
          paymentMethod: PaymentMethod.DIGITAL,
          stripePaymentIntentId: intentRes.body.paymentIntentId,
          deliveryAddress: address,
        })
        .expect(201);

      const row = await ds
        .getRepository(Order)
        .findOneByOrFail({ id: orderRes.body.id });
      expect(row.associatePricing).toBe(true);
      expect(row.pointsRedeemed).toBe('6.00');

      expect(Math.round(parseFloat(row.totalAmount) * 100)).toBe(stripeAmount);
    });
  });

  describe('POST /subscription/checkout-session', () => {
    it('un asociado recibe 403 ASSOCIATE_CANNOT_SUBSCRIBE y no se toca Stripe', async () => {
      const assoc = await seedAssociate(0);

      const res = await request(app.getHttpServer())
        .post('/subscription/checkout-session')
        .set('Authorization', await bearer(assoc))
        .send({
          successUrl: 'https://www.dashgo.dev/subscription?session=success',
          cancelUrl: 'https://www.dashgo.dev/subscription?session=canceled',
        })
        .expect(403);

      expect(res.body.code).toBe('ASSOCIATE_CANNOT_SUBSCRIBE');
      expect(res.body.message).toBe(
        'Los asociados no pueden contratar la suscripción',
      );
      expect(mockStripe.checkout.sessions.create).not.toHaveBeenCalled();
    });
  });

  describe('el precio mayorista no se filtra en las respuestas de orden (R8)', () => {
    it('el cliente que compró un producto con precio de asociado no ve associatePriceCents, el super admin sí', async () => {
      const client = await seedUser(UserRole.CLIENT);
      const admin = await seedUser(UserRole.SUPER_ADMIN_DELIVERY);

      const created = await request(app.getHttpServer())
        .post('/orders')
        .set('Authorization', await bearer(client))
        .send({
          items: [{ productId: listed.id, quantity: 1 }],
          paymentMethod: PaymentMethod.CASH,
          deliveryAddress: address,
        })
        .expect(201);
      const orderId = created.body.id as string;

      type OrderBody = {
        id: string;
        associatePricing?: boolean;
        items: Array<{ product?: { associatePriceCents?: number } }>;
      };

      // El cliente paga el precio público: el producto listado no le cambia nada.
      const row = await ds
        .getRepository(Order)
        .findOneByOrFail({ id: orderId });
      expect(row.associatePricing).toBe(false);
      expect(row.subtotal).toBe('10.00');

      // Cliente: detalle y lista.
      const clientAuth = await bearer(client);
      const detail = await request(app.getHttpServer())
        .get(`/orders/${orderId}`)
        .set('Authorization', clientAuth)
        .expect(200);
      const detailBody = detail.body as OrderBody;
      expect(detailBody.items.length).toBeGreaterThan(0);
      for (const item of detailBody.items) {
        expect(item.product).toBeDefined();
        expect(item.product).not.toHaveProperty('associatePriceCents');
      }

      const list = await request(app.getHttpServer())
        .get('/orders')
        .set('Authorization', clientAuth)
        .expect(200);
      const mine = (list.body as OrderBody[]).find((o) => o.id === orderId);
      expect(mine).toBeDefined();
      for (const item of mine!.items) {
        expect(item.product).not.toHaveProperty('associatePriceCents');
      }

      // Super admin: detalle y lista traen el precio mayorista.
      const adminAuth = await bearer(admin);
      const adminDetail = await request(app.getHttpServer())
        .get(`/orders/${orderId}`)
        .set('Authorization', adminAuth)
        .expect(200);
      for (const item of (adminDetail.body as OrderBody).items) {
        expect(item.product?.associatePriceCents).toBe(LISTED_ASSOCIATE_CENTS);
      }

      const adminList = await request(app.getHttpServer())
        .get('/orders')
        .set('Authorization', adminAuth)
        .expect(200);
      const seen = (adminList.body as OrderBody[]).find(
        (o) => o.id === orderId,
      );
      expect(seen).toBeDefined();
      for (const item of seen!.items) {
        expect(item.product?.associatePriceCents).toBe(LISTED_ASSOCIATE_CENTS);
      }
    });
  });
});
