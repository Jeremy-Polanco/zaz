/**
 * Unit specs for PlanDelinquencyListener.
 *
 * "La suscripción ES el bebedero": el bebedero gratuito de un suscriptor
 * (rentals.monthly_rent_cents = 0) no tiene su propia suscripción de Stripe
 * que pueda fallar, así que su mora hay que espejarla desde el PLAN
 * (subscriptions) que lo paga. Repositories mocked — no real DB.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Rental, RentalStatus } from '../../entities/rental.entity';
import { Subscription, SubscriptionStatus } from '../../entities/subscription.entity';
import { PlanDelinquencyListener } from './plan-delinquency.listener';

function fakeRental(overrides: Partial<Rental> = {}): Rental {
  return {
    id: 'rental-1',
    userId: 'user-1',
    productId: 'product-1',
    orderId: 'order-1',
    stripeSubscriptionId: 'sub_rental_1',
    stripePriceId: 'price_free',
    status: RentalStatus.ACTIVE,
    monthlyRentCents: 0,
    lateFeeCents: 500,
    theftFeeCents: 0,
    theftFeeChargedAt: null,
    currentPeriodStart: null,
    currentPeriodEnd: null,
    activatedAt: null,
    canceledAt: null,
    pastDueSince: null,
    planPastDueSince: null,
    lastLateFeeAt: null,
    nextMaintenanceAt: null,
    lastMaintenanceAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  } as Rental;
}

function fakeSubscription(overrides: Partial<Subscription> = {}): Subscription {
  return {
    id: 'sub-db-1',
    userId: 'user-1',
    stripeSubscriptionId: 'sub_plan_1',
    status: SubscriptionStatus.ACTIVE,
    currentPeriodStart: new Date('2026-01-01T00:00:00Z'),
    currentPeriodEnd: new Date('2026-02-01T00:00:00Z'),
    cancelAtPeriodEnd: false,
    canceledAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as Subscription;
}

describe('PlanDelinquencyListener', () => {
  let listener: PlanDelinquencyListener;
  let rentals: {
    find: jest.Mock;
    save: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let subscriptions: { find: jest.Mock };

  beforeEach(async () => {
    rentals = {
      find: jest.fn().mockResolvedValue([]),
      save: jest.fn().mockImplementation(async (r: Rental) => r),
      createQueryBuilder: jest.fn(),
    };
    // F1(b) — subscriptions.user_id ya NO es UNIQUE (ver migración
    // 1811000000000-DropSubscriptionsUserIdUnique): un usuario puede tener
    // varias filas (cancelación + re-suscripción), así que el listener lee
    // TODAS con `.find()` y resuelve el status "efectivo" él mismo — nunca
    // con `.findOne()`, que dejaría ganar a una fila cualquiera.
    subscriptions = { find: jest.fn().mockResolvedValue([]) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PlanDelinquencyListener,
        { provide: getRepositoryToken(Rental), useValue: rentals },
        { provide: getRepositoryToken(Subscription), useValue: subscriptions },
      ],
    }).compile();

    listener = module.get(PlanDelinquencyListener);
  });

  // ---------------------------------------------------------------------------
  // syncForUser — planStatus PAST_DUE
  // ---------------------------------------------------------------------------

  describe('syncForUser — plan en past_due', () => {
    it('marca los alquileres de $0 como PAST_DUE con marker + pastDueSince', async () => {
      subscriptions.find.mockResolvedValue([
        fakeSubscription({ status: SubscriptionStatus.PAST_DUE }),
      ]);
      const rental = fakeRental({ status: RentalStatus.ACTIVE });
      rentals.find.mockResolvedValue([rental]);

      const outcome = await listener.syncForUser('user-1');

      expect(rentals.save).toHaveBeenCalledTimes(1);
      const saved = rentals.save.mock.calls[0][0] as Rental;
      expect(saved.status).toBe(RentalStatus.PAST_DUE);
      expect(saved.planPastDueSince).toBeInstanceOf(Date);
      expect(saved.pastDueSince).toBeInstanceOf(Date);
      expect(outcome.marked).toBe(1);
    });

    it('write-once: una segunda corrida no pisa los timestamps originales', async () => {
      const firstMark = new Date('2026-01-15T00:00:00Z');
      subscriptions.find.mockResolvedValue([
        fakeSubscription({ status: SubscriptionStatus.PAST_DUE }),
      ]);
      const rental = fakeRental({
        status: RentalStatus.PAST_DUE,
        planPastDueSince: firstMark,
        pastDueSince: firstMark,
      });
      rentals.find.mockResolvedValue([rental]);

      await listener.syncForUser('user-1');

      const saved = rentals.save.mock.calls[0][0] as Rental;
      expect(saved.planPastDueSince).toEqual(firstMark);
      expect(saved.pastDueSince).toEqual(firstMark);
    });
  });

  // ---------------------------------------------------------------------------
  // syncForUser — planStatus UNPAID / CANCELED / INCOMPLETE_EXPIRED
  // ---------------------------------------------------------------------------

  describe('syncForUser — el plan se pierde (unpaid / canceled / incomplete_expired)', () => {
    it.each([
      SubscriptionStatus.UNPAID,
      SubscriptionStatus.CANCELED,
      SubscriptionStatus.INCOMPLETE_EXPIRED,
    ])('plan %s → alquiler de $0 pasa a UNPAID (nunca se cancela ni se llama a Stripe)', async (status) => {
      subscriptions.find.mockResolvedValue([fakeSubscription({ status })]);
      const rental = fakeRental({ status: RentalStatus.PAST_DUE });
      rentals.find.mockResolvedValue([rental]);

      const outcome = await listener.syncForUser('user-1');

      const saved = rentals.save.mock.calls[0][0] as Rental;
      expect(saved.status).toBe(RentalStatus.UNPAID);
      expect(saved.planPastDueSince).toBeInstanceOf(Date);
      expect(outcome.unpaid).toBe(1);
      // Nunca cancela ni escribe canceledAt — el admin retira la unidad a mano.
      expect(saved.canceledAt).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // syncForUser — planStatus ACTIVE (restauración)
  // ---------------------------------------------------------------------------

  describe('syncForUser — el plan vuelve a active', () => {
    it('restaura SOLO los alquileres marcados (planPastDueSince != null)', async () => {
      subscriptions.find.mockResolvedValue([
        fakeSubscription({ status: SubscriptionStatus.ACTIVE }),
      ]);
      const marked = fakeRental({
        id: 'rental-marked',
        status: RentalStatus.UNPAID,
        planPastDueSince: new Date('2026-01-10T00:00:00Z'),
        pastDueSince: new Date('2026-01-10T00:00:00Z'),
      });
      rentals.find.mockResolvedValue([marked]);

      const outcome = await listener.syncForUser('user-1');

      expect(rentals.save).toHaveBeenCalledTimes(1);
      const saved = rentals.save.mock.calls[0][0] as Rental;
      expect(saved.status).toBe(RentalStatus.ACTIVE);
      expect(saved.planPastDueSince).toBeNull();
      expect(saved.pastDueSince).toBeNull();
      expect(outcome.restored).toBe(1);
    });

    it('no toca alquileres sin marcar', async () => {
      subscriptions.find.mockResolvedValue([
        fakeSubscription({ status: SubscriptionStatus.ACTIVE }),
      ]);
      const unmarked = fakeRental({ status: RentalStatus.ACTIVE, planPastDueSince: null });
      rentals.find.mockResolvedValue([unmarked]);

      const outcome = await listener.syncForUser('user-1');

      expect(rentals.save).not.toHaveBeenCalled();
      expect(outcome.restored).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Targets — qué alquileres puede tocar el listener
  // ---------------------------------------------------------------------------

  describe('syncForUser — selección de targets', () => {
    it('excluye rentals con monthlyRentCents > 0, PENDING_SETUP y CANCELED', async () => {
      subscriptions.find.mockResolvedValue([
        fakeSubscription({ status: SubscriptionStatus.PAST_DUE }),
      ]);
      // El repo mock de find recibe el `where` — devolvemos [] para simular que
      // la query de TypeORM ya excluyó todo esto (el listener no filtra en JS).
      rentals.find.mockResolvedValue([]);

      await listener.syncForUser('user-1');

      expect(rentals.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            userId: 'user-1',
            monthlyRentCents: 0,
          }),
        }),
      );
      expect(rentals.save).not.toHaveBeenCalled();
    });

    it('sin suscripción para el usuario → no-op', async () => {
      subscriptions.find.mockResolvedValue([]);

      const outcome = await listener.syncForUser('user-1');

      expect(rentals.find).not.toHaveBeenCalled();
      expect(rentals.save).not.toHaveBeenCalled();
      expect(outcome).toEqual({ marked: 0, unpaid: 0, restored: 0 });
    });

    it('plan INCOMPLETE → no-op (todavía no hay nada que espejar)', async () => {
      subscriptions.find.mockResolvedValue([
        fakeSubscription({ status: SubscriptionStatus.INCOMPLETE }),
      ]);

      const outcome = await listener.syncForUser('user-1');

      expect(rentals.save).not.toHaveBeenCalled();
      expect(outcome).toEqual({ marked: 0, unpaid: 0, restored: 0 });
    });
  });

  // ---------------------------------------------------------------------------
  // F1 — subscriptions.user_id ya no es UNIQUE: un usuario acumula una fila por
  // cada suscripción de Stripe (cancelación + re-suscripción). Una fila VIEJA
  // (p. ej. `canceled`) nunca debe ganarle a una fila VIVA a la hora de
  // resolver el status del plan que se espeja sobre el bebedero de $0.
  // ---------------------------------------------------------------------------

  describe('syncForUser — varias filas de subscriptions (cancelación + re-suscripción)', () => {
    const FUTURE = new Date(Date.now() + 30 * 86400 * 1000);
    const FUTURE_SOON = new Date(Date.now() + 5 * 86400 * 1000);
    const PAST = new Date(Date.now() - 10 * 86400 * 1000);
    const PAST_OLDER = new Date(Date.now() - 40 * 86400 * 1000);

    it('una fila canceled vieja + una fila active viva → ACTIVE (restaura si había marca)', async () => {
      subscriptions.find.mockResolvedValue([
        fakeSubscription({
          id: 'sub-old-canceled',
          status: SubscriptionStatus.CANCELED,
          currentPeriodEnd: PAST_OLDER,
        }),
        fakeSubscription({
          id: 'sub-new-active',
          status: SubscriptionStatus.ACTIVE,
          currentPeriodEnd: FUTURE,
        }),
      ]);
      const marked = fakeRental({
        status: RentalStatus.UNPAID,
        planPastDueSince: PAST,
        pastDueSince: PAST,
      });
      rentals.find.mockResolvedValue([marked]);

      const outcome = await listener.syncForUser('user-1');

      expect(rentals.save).toHaveBeenCalledTimes(1);
      const saved = rentals.save.mock.calls[0][0] as Rental;
      expect(saved.status).toBe(RentalStatus.ACTIVE);
      expect(saved.planPastDueSince).toBeNull();
      expect(outcome.restored).toBe(1);
      expect(outcome.marked).toBe(0);
      expect(outcome.unpaid).toBe(0);
    });

    it('una fila past_due viva + una fila canceled vieja → PAST_DUE', async () => {
      subscriptions.find.mockResolvedValue([
        fakeSubscription({
          id: 'sub-old-canceled',
          status: SubscriptionStatus.CANCELED,
          currentPeriodEnd: PAST_OLDER,
        }),
        fakeSubscription({
          id: 'sub-live-past-due',
          status: SubscriptionStatus.PAST_DUE,
          currentPeriodEnd: FUTURE_SOON,
        }),
      ]);
      const rental = fakeRental({ status: RentalStatus.ACTIVE });
      rentals.find.mockResolvedValue([rental]);

      const outcome = await listener.syncForUser('user-1');

      const saved = rentals.save.mock.calls[0][0] as Rental;
      expect(saved.status).toBe(RentalStatus.PAST_DUE);
      expect(outcome.marked).toBe(1);
    });

    it('todas las filas vencidas → gana la más nueva por currentPeriodEnd', async () => {
      subscriptions.find.mockResolvedValue([
        fakeSubscription({
          id: 'sub-oldest',
          status: SubscriptionStatus.ACTIVE,
          currentPeriodEnd: PAST_OLDER,
        }),
        fakeSubscription({
          id: 'sub-newest-expired',
          status: SubscriptionStatus.UNPAID,
          currentPeriodEnd: PAST,
        }),
      ]);
      const rental = fakeRental({ status: RentalStatus.ACTIVE });
      rentals.find.mockResolvedValue([rental]);

      const outcome = await listener.syncForUser('user-1');

      const saved = rentals.save.mock.calls[0][0] as Rental;
      expect(saved.status).toBe(RentalStatus.UNPAID);
      expect(outcome.unpaid).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // Event handlers
  // ---------------------------------------------------------------------------

  describe('handleStatusChanged (SUBSCRIPTION_STATUS_CHANGED)', () => {
    it('llama a syncForUser con el userId del evento', async () => {
      const spy = jest.spyOn(listener, 'syncForUser').mockResolvedValue({
        marked: 0,
        unpaid: 0,
        restored: 0,
      });

      await listener.handleStatusChanged({
        userId: 'user-42',
        status: SubscriptionStatus.PAST_DUE,
        previousStatus: SubscriptionStatus.ACTIVE,
      });

      expect(spy).toHaveBeenCalledWith('user-42');
    });

    it('un error en syncForUser se atrapa y se loguea — nunca se propaga', async () => {
      jest.spyOn(listener, 'syncForUser').mockRejectedValue(new Error('db caída'));

      await expect(
        listener.handleStatusChanged({
          userId: 'user-42',
          status: SubscriptionStatus.PAST_DUE,
          previousStatus: null,
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe('handleReconciled (SUBSCRIPTION_RECONCILED) → syncAll', () => {
    it('llama a syncForUser una vez por usuario distinto con un rental de $0', async () => {
      const qb = {
        select: jest.fn().mockReturnThis(),
        distinct: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([
          { userId: 'user-1' },
          { userId: 'user-2' },
        ]),
      };
      rentals.createQueryBuilder.mockReturnValue(qb);
      const spy = jest.spyOn(listener, 'syncForUser').mockResolvedValue({
        marked: 1,
        unpaid: 0,
        restored: 0,
      });

      await listener.handleReconciled({
        scanned: 2,
        upserted: 2,
        skipped: 0,
        purged: 0,
        failed: 0,
      });

      expect(spy).toHaveBeenCalledTimes(2);
      expect(spy).toHaveBeenCalledWith('user-1');
      expect(spy).toHaveBeenCalledWith('user-2');
    });

    it('un error listando usuarios se atrapa y no lanza', async () => {
      rentals.createQueryBuilder.mockImplementation(() => {
        throw new Error('db caída');
      });

      await expect(
        listener.handleReconciled({
          scanned: 0,
          upserted: 0,
          skipped: 0,
          purged: 0,
          failed: 0,
        }),
      ).resolves.toBeUndefined();
    });
  });
});
