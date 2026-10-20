/**
 * RentalPaymentMethodReconcileCron — repara las suscripciones de alquiler que
 * se crearon SIN método de pago (bug del 2026-10-20): les pone el de la tarjeta
 * del cliente y, si ya cayeron en past_due, reintenta su factura abierta.
 *
 * No escribe el estado del alquiler: los cambios de Stripe regresan por los
 * webhooks (handleSubscriptionUpdated).
 */
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { IsNull, Not } from 'typeorm';
import { Rental, RentalStatus } from '../../entities/rental.entity';
import { RentalPaymentMethodReconcileCron } from './rental-payment-method-reconcile.cron';
import { StripePaymentMethodResolver } from './stripe-payment-method.resolver';
import { createMockStripe, MockStripe } from '../../test-utils/stripe';

function stripeSub(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sub_1',
    status: 'active',
    customer: 'cus_1',
    default_payment_method: null,
    latest_invoice: null,
    ...overrides,
  };
}

describe('RentalPaymentMethodReconcileCron', () => {
  let cron: RentalPaymentMethodReconcileCron;
  let stripe: MockStripe;
  let rentalRepo: { find: jest.Mock; update: jest.Mock };
  let resolver: { ensureCustomerDefault: jest.Mock; getStripe: jest.Mock };

  const rental = (id: string, sub: string) =>
    ({ id, stripeSubscriptionId: sub, status: RentalStatus.ACTIVE }) as Rental;

  beforeEach(async () => {
    stripe = createMockStripe();
    rentalRepo = {
      find: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    resolver = {
      ensureCustomerDefault: jest.fn().mockResolvedValue('pm_card'),
      getStripe: jest.fn().mockReturnValue(stripe),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RentalPaymentMethodReconcileCron,
        { provide: getRepositoryToken(Rental), useValue: rentalRepo },
        { provide: StripePaymentMethodResolver, useValue: resolver },
      ],
    }).compile();
    cron = module.get(RentalPaymentMethodReconcileCron);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('busca sólo alquileres ACTIVE / PAST_DUE con suscripción de Stripe', async () => {
    await cron.reconcile();

    const where = rentalRepo.find.mock.calls[0][0].where as {
      status: { value: RentalStatus[] };
      stripeSubscriptionId: unknown;
    };
    expect([...where.status.value].sort()).toEqual(
      [RentalStatus.ACTIVE, RentalStatus.PAST_DUE].sort(),
    );
    expect(where.stripeSubscriptionId).toBeDefined();
  });

  it('parchea una suscripción sin método de pago con el de la tarjeta del cliente', async () => {
    rentalRepo.find.mockResolvedValue([rental('r1', 'sub_1')]);
    stripe.subscriptions.retrieve.mockResolvedValueOnce(stripeSub());

    const res = await cron.reconcile();

    expect(resolver.ensureCustomerDefault).toHaveBeenCalledWith('cus_1');
    expect(stripe.subscriptions.update).toHaveBeenCalledWith('sub_1', {
      default_payment_method: 'pm_card',
    });
    expect(res).toEqual({ scanned: 1, patched: 1, invoicesPaid: 0, skipped: 0, failed: 0 });
    // No tiene factura que cobrar (activa): no se llama a invoices.pay.
    expect(stripe.invoices.pay).not.toHaveBeenCalled();
  });

  it('salta la que ya tiene método de pago (sin tocar Stripe)', async () => {
    rentalRepo.find.mockResolvedValue([rental('r1', 'sub_1')]);
    stripe.subscriptions.retrieve.mockResolvedValueOnce(
      stripeSub({ default_payment_method: 'pm_existing' }),
    );

    const res = await cron.reconcile();

    expect(stripe.subscriptions.update).not.toHaveBeenCalled();
    expect(stripe.invoices.pay).not.toHaveBeenCalled();
    // Ya tenía tarjeta: si está en mora es un rechazo real, la gracia no se toca.
    expect(rentalRepo.update).not.toHaveBeenCalled();
    expect(res).toEqual({ scanned: 1, patched: 0, invoicesPaid: 0, skipped: 1, failed: 0 });
  });

  it.each(['canceled', 'incomplete_expired'])(
    'salta las suscripciones %s en Stripe',
    async (status) => {
      rentalRepo.find.mockResolvedValue([rental('r1', 'sub_1')]);
      stripe.subscriptions.retrieve.mockResolvedValueOnce(stripeSub({ status }));

      const res = await cron.reconcile();

      expect(resolver.ensureCustomerDefault).not.toHaveBeenCalled();
      expect(stripe.subscriptions.update).not.toHaveBeenCalled();
      expect(res.skipped).toBe(1);
    },
  );

  it('sin tarjeta resoluble no parchea: cuenta como saltada', async () => {
    rentalRepo.find.mockResolvedValue([rental('r1', 'sub_1')]);
    stripe.subscriptions.retrieve.mockResolvedValueOnce(stripeSub());
    resolver.ensureCustomerDefault.mockResolvedValueOnce(null);

    const res = await cron.reconcile();

    expect(stripe.subscriptions.update).not.toHaveBeenCalled();
    expect(res).toEqual({ scanned: 1, patched: 0, invoicesPaid: 0, skipped: 1, failed: 0 });
  });

  it('cobra la factura abierta de una suscripción past_due recién parchada', async () => {
    rentalRepo.find.mockResolvedValue([rental('r1', 'sub_1')]);
    stripe.subscriptions.retrieve.mockResolvedValueOnce(
      stripeSub({
        status: 'past_due',
        latest_invoice: { id: 'in_1', status: 'open' },
      }),
    );

    const res = await cron.reconcile();

    expect(stripe.subscriptions.retrieve).toHaveBeenCalledWith('sub_1', {
      expand: ['latest_invoice'],
    });
    expect(stripe.invoices.pay).toHaveBeenCalledTimes(1);
    expect(stripe.invoices.pay.mock.calls[0][0]).toBe('in_1');
    expect(stripe.invoices.pay.mock.calls[0][1]).toEqual({ payment_method: 'pm_card' });
    expect(res).toEqual({ scanned: 1, patched: 1, invoicesPaid: 1, skipped: 0, failed: 0 });
  });

  // La mora de una suscripción SIN tarjeta fue culpa nuestra: la gracia de 3
  // días de la multa (LateFeeCron, 03:00 UTC, pastDueSince <= ahora-3d) arranca
  // recién cuando el cliente tiene una tarjeta puesta. Si no, un reintento que
  // rebota hoy dejaría al cliente con multa esta misma noche.
  it('past_due recién parchada: reinicia pastDueSince a ahora ANTES de parchear y cobrar', async () => {
    rentalRepo.find.mockResolvedValue([
      { ...rental('r1', 'sub_1'), status: RentalStatus.PAST_DUE } as Rental,
    ]);
    stripe.subscriptions.retrieve.mockResolvedValueOnce(
      stripeSub({ status: 'past_due', latest_invoice: { id: 'in_1', status: 'open' } }),
    );
    const before = Date.now();

    await cron.reconcile();

    expect(rentalRepo.update).toHaveBeenCalledTimes(1);
    const [where, patch] = rentalRepo.update.mock.calls[0] as [
      Record<string, unknown>,
      { pastDueSince: Date },
    ];
    // Sólo si ya tenía Día 0: no inventa una mora que la BD todavía no vio.
    expect(where).toEqual({ id: 'r1', pastDueSince: Not(IsNull()) });
    expect(patch.pastDueSince).toBeInstanceOf(Date);
    expect(patch.pastDueSince.getTime()).toBeGreaterThanOrEqual(before);
    // Antes de tocar Stripe: así el webhook del parche no la pisa con la fecha vieja.
    expect(rentalRepo.update.mock.invocationCallOrder[0]).toBeLessThan(
      stripe.subscriptions.update.mock.invocationCallOrder[0],
    );
  });

  it('una trialing/active parchada no toca pastDueSince', async () => {
    rentalRepo.find.mockResolvedValue([rental('r1', 'sub_1')]);
    stripe.subscriptions.retrieve.mockResolvedValueOnce(stripeSub({ status: 'trialing' }));

    const res = await cron.reconcile();

    expect(res.patched).toBe(1);
    expect(rentalRepo.update).not.toHaveBeenCalled();
  });

  it('si falla el reinicio de la gracia en BD, igual parchea y cobra', async () => {
    rentalRepo.find.mockResolvedValue([rental('r1', 'sub_1')]);
    stripe.subscriptions.retrieve.mockResolvedValueOnce(
      stripeSub({ status: 'past_due', latest_invoice: { id: 'in_1', status: 'open' } }),
    );
    rentalRepo.update.mockRejectedValueOnce(new Error('db blip'));

    const res = await cron.reconcile();

    expect(res).toEqual({ scanned: 1, patched: 1, invoicesPaid: 1, skipped: 0, failed: 0 });
  });

  it('past_due con la factura ya pagada/anulada no intenta cobrar', async () => {
    rentalRepo.find.mockResolvedValue([rental('r1', 'sub_1')]);
    stripe.subscriptions.retrieve.mockResolvedValueOnce(
      stripeSub({ status: 'past_due', latest_invoice: { id: 'in_1', status: 'paid' } }),
    );

    const res = await cron.reconcile();

    expect(stripe.invoices.pay).not.toHaveBeenCalled();
    expect(res.invoicesPaid).toBe(0);
    expect(res.patched).toBe(1);
  });

  it('latest_invoice como id sin expandir: la consulta antes de cobrar', async () => {
    rentalRepo.find.mockResolvedValue([rental('r1', 'sub_1')]);
    stripe.subscriptions.retrieve.mockResolvedValueOnce(
      stripeSub({ status: 'past_due', latest_invoice: 'in_9' }),
    );
    stripe.invoices.retrieve.mockResolvedValueOnce({ id: 'in_9', status: 'open' });

    const res = await cron.reconcile();

    expect(stripe.invoices.retrieve).toHaveBeenCalledWith('in_9');
    expect(stripe.invoices.pay.mock.calls[0][0]).toBe('in_9');
    expect(res.invoicesPaid).toBe(1);
  });

  it('si el cobro de la factura falla, lo cuenta como failed y no lanza', async () => {
    rentalRepo.find.mockResolvedValue([rental('r1', 'sub_1')]);
    stripe.subscriptions.retrieve.mockResolvedValueOnce(
      stripeSub({ status: 'past_due', latest_invoice: { id: 'in_1', status: 'open' } }),
    );
    stripe.invoices.pay.mockRejectedValueOnce(new Error('card_declined'));

    const res = await cron.reconcile();

    expect(res).toEqual({ scanned: 1, patched: 1, invoicesPaid: 0, skipped: 0, failed: 1 });
  });

  it('un error en un alquiler no frena a los demás', async () => {
    rentalRepo.find.mockResolvedValue([
      rental('r1', 'sub_1'),
      rental('r2', 'sub_2'),
    ]);
    stripe.subscriptions.retrieve
      .mockRejectedValueOnce(new Error('stripe 500'))
      .mockResolvedValueOnce(stripeSub({ id: 'sub_2' }));

    const res = await cron.reconcile();

    expect(res).toEqual({ scanned: 2, patched: 1, invoicesPaid: 0, skipped: 0, failed: 1 });
    expect(stripe.subscriptions.update).toHaveBeenCalledWith('sub_2', {
      default_payment_method: 'pm_card',
    });
  });

  it('sin Stripe configurado no hace nada', async () => {
    resolver.getStripe.mockReturnValue(null);
    rentalRepo.find.mockResolvedValue([rental('r1', 'sub_1')]);

    const res = await cron.reconcile();

    expect(res).toEqual({ scanned: 0, patched: 0, invoicesPaid: 0, skipped: 0, failed: 0 });
  });

  describe('corridas programadas', () => {
    it('el cron diario corre reconcile', async () => {
      const spy = jest.spyOn(cron, 'reconcile');
      await cron.runDaily();
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it('guarda de reentrada: una corrida simultánea se omite', async () => {
      let release!: () => void;
      rentalRepo.find.mockReturnValueOnce(
        new Promise<Rental[]>((resolve) => {
          release = () => resolve([]);
        }),
      );

      const first = cron.reconcile();
      const second = await cron.reconcile();

      expect(second).toEqual({ scanned: 0, patched: 0, invoicesPaid: 0, skipped: 0, failed: 0 });
      expect(rentalRepo.find).toHaveBeenCalledTimes(1);
      release();
      await first;

      // Terminada la primera, se puede volver a correr.
      await cron.reconcile();
      expect(rentalRepo.find).toHaveBeenCalledTimes(2);
    });

    it('al arrancar programa la corrida ~45 s después, fuera del camino de boot', async () => {
      jest.useFakeTimers();
      cron.onApplicationBootstrap();
      expect(rentalRepo.find).not.toHaveBeenCalled();

      jest.advanceTimersByTime(44_000);
      expect(rentalRepo.find).not.toHaveBeenCalled();

      jest.advanceTimersByTime(1_000);
      expect(rentalRepo.find).toHaveBeenCalledTimes(1);
    });

    it('un fallo de base de datos en la corrida no tira el proceso', async () => {
      rentalRepo.find.mockRejectedValueOnce(new Error('db down'));
      await expect(cron.runDaily()).resolves.toBeUndefined();
    });
  });
});
