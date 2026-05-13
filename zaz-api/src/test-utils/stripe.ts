/**
 * Stripe mock factory for unit and integration tests.
 *
 * Usage in a spec file:
 *
 *   jest.mock('stripe', () => ({
 *     default: jest.fn().mockImplementation(() => createMockStripe()),
 *   }));
 *
 * Per-test customization:
 *   mockStripe.customers.create.mockResolvedValueOnce({ id: 'cus_test' });
 *
 * The factory returns jest.fn() for every method the production code calls.
 * Methods that need sensible defaults (e.g. customers.search returns empty list)
 * are pre-configured. All others default to jest.fn() (resolves to undefined).
 */

export interface MockStripe {
  customers: {
    create: jest.Mock;
    search: jest.Mock;
    update: jest.Mock;
    list: jest.Mock;
  };
  subscriptions: {
    retrieve: jest.Mock;
    update: jest.Mock;
    list: jest.Mock;
  };
  prices: {
    retrieve: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
  };
  products: {
    update: jest.Mock;
  };
  checkout: {
    sessions: {
      create: jest.Mock;
    };
  };
  billingPortal: {
    sessions: {
      create: jest.Mock;
    };
  };
  paymentIntents: {
    create: jest.Mock;
    retrieve: jest.Mock;
    cancel: jest.Mock;
    capture: jest.Mock;
  };
  webhooks: {
    constructEvent: jest.Mock;
  };
}

/**
 * Creates a fresh mock Stripe instance.
 * Call this once per test suite (the jest.mock factory calls it once per
 * test file) and reset individual mocks with mockReset / mockResolvedValueOnce.
 */
export function createMockStripe(): MockStripe {
  return {
    customers: {
      create: jest.fn().mockResolvedValue({ id: 'cus_test_default' }),
      search: jest.fn().mockResolvedValue({ data: [] }),
      update: jest.fn().mockResolvedValue({}),
      list: jest.fn().mockResolvedValue({ data: [] }),
    },
    prices: {
      retrieve: jest.fn().mockResolvedValue({
        id: 'price_test_monthly',
        product: 'prod_test_default',
        unit_amount: 1000,
        currency: 'usd',
        recurring: { interval: 'month' },
      }),
      create: jest.fn().mockResolvedValue({
        id: 'price_new_default',
        product: 'prod_test_default',
        unit_amount: 1500,
        currency: 'usd',
        recurring: { interval: 'month' },
      }),
      update: jest.fn().mockResolvedValue({}),
    },
    products: {
      update: jest.fn().mockResolvedValue({}),
    },
    subscriptions: {
      retrieve: jest.fn().mockResolvedValue({
        id: 'sub_test_default',
        status: 'active',
        current_period_start: Math.floor(Date.now() / 1000) - 86400,
        current_period_end: Math.floor(Date.now() / 1000) + 86400 * 29,
        cancel_at_period_end: false,
        canceled_at: null,
        metadata: {},
      }),
      update: jest.fn().mockResolvedValue({}),
      list: jest.fn().mockResolvedValue({ data: [] }),
    },
    checkout: {
      sessions: {
        create: jest.fn().mockResolvedValue({
          id: 'cs_test_default',
          url: 'https://stripe.test/session',
        }),
      },
    },
    billingPortal: {
      sessions: {
        create: jest.fn().mockResolvedValue({
          url: 'https://stripe.test/portal',
        }),
      },
    },
    paymentIntents: {
      create: jest.fn().mockResolvedValue({
        id: 'pi_test_default',
        client_secret: 'pi_test_default_secret',
        status: 'requires_payment_method',
        amount: 1000,
        currency: 'usd',
      }),
      retrieve: jest.fn().mockResolvedValue({
        id: 'pi_test_default',
        client_secret: 'pi_test_default_secret',
        status: 'requires_payment_method',
        amount: 1000,
        currency: 'usd',
      }),
      cancel: jest.fn().mockResolvedValue({ id: 'pi_test_default', status: 'canceled' }),
      capture: jest.fn().mockResolvedValue({ id: 'pi_test_default', status: 'succeeded' }),
    },
    webhooks: {
      /**
       * Default: parse rawBody as JSON and return it directly.
       * Production code passes (rawBody, signature, secret) — we mock away
       * the signature verification entirely. Tests that need specific events
       * should do:
       *   mockStripe.webhooks.constructEvent.mockReturnValueOnce(myEvent)
       */
      constructEvent: jest.fn((rawBody: Buffer | string) => {
        const body = Buffer.isBuffer(rawBody) ? rawBody.toString() : rawBody;
        return JSON.parse(body) as unknown;
      }),
    },
  };
}

/**
 * Resets all mocked functions on a MockStripe instance back to their default
 * implementations. Call in beforeEach if you share a mock across tests.
 */
export function resetMockStripe(mock: MockStripe): void {
  const fresh = createMockStripe();
  mock.customers.create.mockReset().mockImplementation(fresh.customers.create);
  mock.customers.search.mockReset().mockImplementation(fresh.customers.search);
  mock.customers.update.mockReset().mockImplementation(fresh.customers.update);
  mock.customers.list.mockReset().mockImplementation(fresh.customers.list);
  mock.prices.retrieve.mockReset().mockImplementation(fresh.prices.retrieve);
  mock.prices.create.mockReset().mockImplementation(fresh.prices.create);
  mock.prices.update.mockReset().mockImplementation(fresh.prices.update);
  mock.products.update.mockReset().mockImplementation(fresh.products.update);
  mock.subscriptions.retrieve.mockReset().mockImplementation(fresh.subscriptions.retrieve);
  mock.subscriptions.update.mockReset().mockImplementation(fresh.subscriptions.update);
  mock.subscriptions.list.mockReset().mockImplementation(fresh.subscriptions.list);
  mock.checkout.sessions.create.mockReset().mockImplementation(fresh.checkout.sessions.create);
  mock.billingPortal.sessions.create.mockReset().mockImplementation(fresh.billingPortal.sessions.create);
  mock.paymentIntents.create.mockReset().mockImplementation(fresh.paymentIntents.create);
  mock.paymentIntents.retrieve.mockReset().mockImplementation(fresh.paymentIntents.retrieve);
  mock.paymentIntents.cancel.mockReset().mockImplementation(fresh.paymentIntents.cancel);
  mock.paymentIntents.capture.mockReset().mockImplementation(fresh.paymentIntents.capture);
  mock.webhooks.constructEvent.mockReset().mockImplementation(fresh.webhooks.constructEvent);
}
