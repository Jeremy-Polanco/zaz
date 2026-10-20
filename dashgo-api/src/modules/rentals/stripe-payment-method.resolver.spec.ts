/**
 * StripePaymentMethodResolver — encuentra el método de pago de un cliente de
 * Stripe para los cobros que crea la API (suscripción del 2º bebedero, multas).
 *
 * Contexto del bug (2026-10-20): `subscriptions.create` y `paymentIntents.create`
 * se llamaban sin método de pago; el cliente sólo tenía la tarjeta guardada en
 * la suscripción del PLAN (Checkout), así que el primer cobro de $6.99 fallaba.
 */
import { ConfigService } from '@nestjs/config';
import { StripePaymentMethodResolver } from './stripe-payment-method.resolver';
import { createMockStripe, MockStripe } from '../../test-utils/stripe';

jest.mock('stripe', () => {
  const mock = jest.fn().mockImplementation(() => mockStripeInstance);
  (mock as unknown as Record<string, unknown>)['default'] = mock;
  return mock;
});

let mockStripeInstance: MockStripe;

const CUS = 'cus_1';

describe('StripePaymentMethodResolver', () => {
  let resolver: StripePaymentMethodResolver;

  beforeEach(() => {
    mockStripeInstance = createMockStripe();
    resolver = new StripePaymentMethodResolver({
      get: jest.fn().mockReturnValue('sk_test_key'),
    } as unknown as ConfigService);
    resolver.onModuleInit();
  });

  const customer = (pm: unknown) => ({
    id: CUS,
    invoice_settings: { default_payment_method: pm },
  });

  describe('resolveForCustomer', () => {
    it('1) usa el default de la factura del cliente (id string)', async () => {
      mockStripeInstance.customers.retrieve.mockResolvedValueOnce(customer('pm_cust'));

      await expect(resolver.resolveForCustomer(CUS)).resolves.toBe('pm_cust');
      expect(mockStripeInstance.subscriptions.list).not.toHaveBeenCalled();
      expect(mockStripeInstance.paymentMethods.list).not.toHaveBeenCalled();
    });

    it('1) acepta el default expandido como objeto', async () => {
      mockStripeInstance.customers.retrieve.mockResolvedValueOnce(
        customer({ id: 'pm_obj' }),
      );
      await expect(resolver.resolveForCustomer(CUS)).resolves.toBe('pm_obj');
    });

    it('2) sin default de cliente, toma el de la suscripción del PLAN (sin rentalId)', async () => {
      mockStripeInstance.customers.retrieve.mockResolvedValueOnce(customer(null));
      mockStripeInstance.subscriptions.list.mockResolvedValueOnce({
        data: [
          { id: 'sub_rental', default_payment_method: 'pm_rental', metadata: { rentalId: 'r1' } },
          { id: 'sub_plan', default_payment_method: 'pm_plan', metadata: {} },
        ],
      });

      await expect(resolver.resolveForCustomer(CUS)).resolves.toBe('pm_plan');
      expect(mockStripeInstance.subscriptions.list).toHaveBeenCalledWith({
        customer: CUS,
        status: 'active',
        limit: 10,
      });
    });

    it('2) si sólo hay suscripciones de alquiler con PM, cae a cualquiera de ellas', async () => {
      mockStripeInstance.customers.retrieve.mockResolvedValueOnce(customer(null));
      mockStripeInstance.subscriptions.list.mockResolvedValueOnce({
        data: [
          { id: 'sub_rental', default_payment_method: { id: 'pm_rental' }, metadata: { rentalId: 'r1' } },
        ],
      });

      await expect(resolver.resolveForCustomer(CUS)).resolves.toBe('pm_rental');
    });

    it('2) ignora suscripciones sin PM y prueba past_due y luego trialing', async () => {
      mockStripeInstance.customers.retrieve.mockResolvedValueOnce(customer(null));
      mockStripeInstance.subscriptions.list
        .mockResolvedValueOnce({ data: [{ id: 's1', default_payment_method: null, metadata: {} }] }) // active
        .mockResolvedValueOnce({ data: [] }) // past_due
        .mockResolvedValueOnce({
          data: [{ id: 's3', default_payment_method: 'pm_trial', metadata: {} }],
        }); // trialing

      await expect(resolver.resolveForCustomer(CUS)).resolves.toBe('pm_trial');
      const statuses = mockStripeInstance.subscriptions.list.mock.calls.map(
        (c) => (c[0] as { status: string }).status,
      );
      expect(statuses).toEqual(['active', 'past_due', 'trialing']);
    });

    it('3) sin suscripciones útiles, usa la tarjeta adjunta más reciente', async () => {
      mockStripeInstance.customers.retrieve.mockResolvedValueOnce(customer(null));
      mockStripeInstance.paymentMethods.list.mockResolvedValueOnce({
        data: [{ id: 'pm_card' }],
      });

      await expect(resolver.resolveForCustomer(CUS)).resolves.toBe('pm_card');
      expect(mockStripeInstance.paymentMethods.list).toHaveBeenCalledWith({
        customer: CUS,
        type: 'card',
        limit: 1,
      });
    });

    it('devuelve null si no hay nada', async () => {
      mockStripeInstance.customers.retrieve.mockResolvedValueOnce(customer(null));
      await expect(resolver.resolveForCustomer(CUS)).resolves.toBeNull();
    });

    it('devuelve null (sin lanzar) si Stripe falla', async () => {
      mockStripeInstance.customers.retrieve.mockRejectedValueOnce(new Error('stripe down'));
      await expect(resolver.resolveForCustomer(CUS)).resolves.toBeNull();
    });

    it('devuelve null si Stripe no está configurado', async () => {
      const bare = new StripePaymentMethodResolver({
        get: jest.fn().mockReturnValue(undefined),
      } as unknown as ConfigService);
      bare.onModuleInit();
      await expect(bare.resolveForCustomer(CUS)).resolves.toBeNull();
    });
  });

  describe('ensureCustomerDefault', () => {
    it('si el cliente ya tenía default, no lo toca', async () => {
      mockStripeInstance.customers.retrieve.mockResolvedValue(customer('pm_cust'));

      await expect(resolver.ensureCustomerDefault(CUS)).resolves.toBe('pm_cust');
      expect(mockStripeInstance.customers.update).not.toHaveBeenCalled();
    });

    it('si lo encontró en otro lado, lo fija como default del cliente', async () => {
      mockStripeInstance.customers.retrieve.mockResolvedValue(customer(null));
      mockStripeInstance.subscriptions.list.mockResolvedValueOnce({
        data: [{ id: 'sub_plan', default_payment_method: 'pm_plan', metadata: {} }],
      });

      await expect(resolver.ensureCustomerDefault(CUS)).resolves.toBe('pm_plan');
      expect(mockStripeInstance.customers.update).toHaveBeenCalledWith(CUS, {
        invoice_settings: { default_payment_method: 'pm_plan' },
      });
    });

    it('si no encuentra nada, devuelve null y no actualiza', async () => {
      mockStripeInstance.customers.retrieve.mockResolvedValue(customer(null));
      await expect(resolver.ensureCustomerDefault(CUS)).resolves.toBeNull();
      expect(mockStripeInstance.customers.update).not.toHaveBeenCalled();
    });

    it('un fallo al fijar el default no tira: igual devuelve el PM resuelto', async () => {
      mockStripeInstance.customers.retrieve.mockResolvedValue(customer(null));
      mockStripeInstance.paymentMethods.list.mockResolvedValueOnce({ data: [{ id: 'pm_card' }] });
      mockStripeInstance.customers.update.mockRejectedValueOnce(new Error('boom'));

      await expect(resolver.ensureCustomerDefault(CUS)).resolves.toBe('pm_card');
    });

    it('si Stripe falla en la resolución, devuelve null sin lanzar', async () => {
      mockStripeInstance.customers.retrieve.mockRejectedValue(new Error('down'));
      await expect(resolver.ensureCustomerDefault(CUS)).resolves.toBeNull();
    });
  });
});
