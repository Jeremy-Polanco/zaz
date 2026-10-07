import { Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Order, Product, Rental, User } from '../../entities';
import { OrderStatus, PaymentMethod, UserRole } from '../../entities/enums';
import { RentalStatus } from '../../entities/rental.entity';
import { SubscriptionStatus } from '../../entities/subscription.entity';
import { SubscriptionService } from '../subscription/subscription.service';
import { MaintenanceCron, isWithinBootWindow } from './maintenance.cron';
import { OrdersService } from './orders.service';

/**
 * Mantenimiento automático — MaintenanceCron.
 *
 * Todas las fechas son instantes explícitos y el "hoy" del negocio es el día de
 * America/New_York: los tests no dependen de la zona del proceso (corren igual
 * con TZ=UTC, que es la del CI).
 *
 * NOW = 2026-10-02T12:00:00Z = viernes 8:00 AM en Nueva York (EDT, UTC-4).
 * El día de negocio es '2026-10-02'.
 */
const NOW = new Date('2026-10-02T12:00:00Z');
const TODAY = '2026-10-02';
const MAINTENANCE_PRODUCT_ID = 'prod-maintenance';

const activePlan = (): unknown => ({
  status: SubscriptionStatus.ACTIVE,
  currentPeriodEnd: new Date('2026-11-01T00:00:00Z'),
});

function makeRental(overrides: Partial<Rental> & { id: string }): Rental {
  return {
    userId: 'user-a',
    status: RentalStatus.ACTIVE,
    // Vencido desde ayer a las 11:00 de Nueva York.
    nextMaintenanceAt: new Date('2026-10-01T15:00:00Z'),
    maintenanceOrderId: null,
    product: { requiresMaintenance: true } as Product,
    user: { id: overrides.userId ?? 'user-a', maintenanceTimerDisabled: false } as User,
    ...overrides,
  } as Rental;
}

describe('MaintenanceCron', () => {
  let cron: MaintenanceCron;
  let products: { findOne: jest.Mock };
  let rentals: { find: jest.Mock; update: jest.Mock };
  let orders: { find: jest.Mock };
  let ordersService: { create: jest.Mock };
  let subscriptions: { resolvePlanRowsByUserIds: jest.Mock };

  /** Devuelve el mapa userId → fila de plan que el cron espera. */
  const plans = (entries: Record<string, unknown>): void => {
    subscriptions.resolvePlanRowsByUserIds.mockResolvedValue(
      new Map(Object.entries(entries)),
    );
  };

  beforeEach(async () => {
    products = {
      findOne: jest.fn().mockResolvedValue({
        id: MAINTENANCE_PRODUCT_ID,
        isMaintenanceService: true,
        isAvailable: true,
      }),
    };
    rentals = {
      find: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    orders = { find: jest.fn().mockResolvedValue([]) };
    let seq = 0;
    ordersService = {
      create: jest.fn().mockImplementation(async () => ({
        id: `order-${(seq += 1)}`,
      })),
    };
    subscriptions = {
      resolvePlanRowsByUserIds: jest.fn().mockResolvedValue(new Map()),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MaintenanceCron,
        { provide: getRepositoryToken(Product), useValue: products },
        { provide: getRepositoryToken(Rental), useValue: rentals },
        { provide: getRepositoryToken(Order), useValue: orders },
        { provide: OrdersService, useValue: ordersService },
        { provide: SubscriptionService, useValue: subscriptions },
      ],
    }).compile();

    cron = module.get(MaintenanceCron);
  });

  describe('qué rentals son candidatos', () => {
    it('pide sólo bebederos ACTIVE con contador y trae el producto y el usuario', async () => {
      await cron.generateDueMaintenanceOrders(NOW);

      expect(rentals.find).toHaveBeenCalledTimes(1);
      const args = rentals.find.mock.calls[0][0];
      expect(args.where.status).toBe(RentalStatus.ACTIVE);
      // `<=` un horizonte, nunca un "= null": las filas sin contador no entran.
      expect(args.where.nextMaintenanceAt.type).toBe('lessThanOrEqual');
      expect(args.relations).toEqual(
        expect.arrayContaining(['product', 'user']),
      );
    });

    it('crea la visita sólo para el suscriptor con plan ACTIVE y bebedero vencido', async () => {
      rentals.find.mockResolvedValue([makeRental({ id: 'r1' })]);
      plans({ 'user-a': activePlan() });

      const result = await cron.generateDueMaintenanceOrders(NOW);

      expect(ordersService.create).toHaveBeenCalledTimes(1);
      expect(ordersService.create).toHaveBeenCalledWith(
        { id: 'user-a', role: UserRole.CLIENT, email: null },
        {
          items: [{ productId: MAINTENANCE_PRODUCT_ID, quantity: 1 }],
          paymentMethod: PaymentMethod.CASH,
          usePoints: false,
          useCredit: false,
        },
        { provisioned: true, scheduledDeliveryDate: TODAY },
      );
      expect(result).toEqual({ candidates: 1, created: 1, skipped: 0, failed: 0 });
    });

    it('resuelve los planes de todos los usuarios en UNA sola consulta', async () => {
      rentals.find.mockResolvedValue([
        makeRental({ id: 'r1', userId: 'user-a' }),
        makeRental({ id: 'r2', userId: 'user-b' }),
      ]);
      plans({ 'user-a': activePlan(), 'user-b': activePlan() });

      await cron.generateDueMaintenanceOrders(NOW);

      expect(subscriptions.resolvePlanRowsByUserIds).toHaveBeenCalledTimes(1);
      expect(subscriptions.resolvePlanRowsByUserIds.mock.calls[0][0].sort()).toEqual(
        ['user-a', 'user-b'],
      );
    });

    it('NO crea visita si el plan está en past_due: no hay visita gratis en mora', async () => {
      rentals.find.mockResolvedValue([makeRental({ id: 'r1' })]);
      plans({
        'user-a': {
          status: SubscriptionStatus.PAST_DUE,
          currentPeriodEnd: new Date('2026-11-01T00:00:00Z'),
        },
      });

      const result = await cron.generateDueMaintenanceOrders(NOW);

      expect(ordersService.create).not.toHaveBeenCalled();
      expect(result).toEqual({ candidates: 1, created: 0, skipped: 1, failed: 0 });
    });

    it('NO crea visita si el usuario no tiene ningún plan', async () => {
      rentals.find.mockResolvedValue([makeRental({ id: 'r1' })]);
      plans({});

      const result = await cron.generateDueMaintenanceOrders(NOW);

      expect(ordersService.create).not.toHaveBeenCalled();
      expect(result.skipped).toBe(1);
    });

    it('NO crea visita si el plan figura ACTIVE pero su periodo ya venció', async () => {
      // La misma regla que isActiveSubscriber: sin periodo vigente el usuario no
      // es suscriptor, create() no le daría el mantenimiento a $0 y el sistema le
      // generaría una orden de pago que nadie pidió.
      rentals.find.mockResolvedValue([makeRental({ id: 'r1' })]);
      plans({
        'user-a': {
          status: SubscriptionStatus.ACTIVE,
          currentPeriodEnd: new Date('2026-09-30T00:00:00Z'),
        },
      });

      await cron.generateDueMaintenanceOrders(NOW);

      expect(ordersService.create).not.toHaveBeenCalled();
    });

    it('NO crea visita si el admin apagó el contador del usuario', async () => {
      rentals.find.mockResolvedValue([
        makeRental({
          id: 'r1',
          user: { id: 'user-a', maintenanceTimerDisabled: true } as User,
        }),
      ]);
      plans({ 'user-a': activePlan() });

      const result = await cron.generateDueMaintenanceOrders(NOW);

      expect(ordersService.create).not.toHaveBeenCalled();
      expect(result.candidates).toBe(0);
    });

    it('NO crea visita para un rental cuyo producto no requiere mantenimiento', async () => {
      rentals.find.mockResolvedValue([
        makeRental({
          id: 'r1',
          product: { requiresMaintenance: false } as Product,
        }),
      ]);
      plans({ 'user-a': activePlan() });

      const result = await cron.generateDueMaintenanceOrders(NOW);

      expect(ordersService.create).not.toHaveBeenCalled();
      expect(result.candidates).toBe(0);
    });
  });

  describe('día de vencimiento (día de Nueva York, no UTC)', () => {
    it('NO crea visita si vence MAÑANA en Nueva York (00:00 EDT = 04:00Z)', async () => {
      rentals.find.mockResolvedValue([
        makeRental({
          id: 'r1',
          nextMaintenanceAt: new Date('2026-10-03T04:00:00Z'),
        }),
      ]);
      plans({ 'user-a': activePlan() });

      const result = await cron.generateDueMaintenanceOrders(NOW);

      expect(ordersService.create).not.toHaveBeenCalled();
      expect(result).toEqual({ candidates: 0, created: 0, skipped: 0, failed: 0 });
    });

    it('SÍ crea la visita si vence más tarde HOY en Nueva York, aunque en UTC ya sea mañana', async () => {
      // 23:59:59 EDT del 2 de octubre = 03:59:59Z del 3: el día UTC ya cambió,
      // el día del negocio no. La visita se genera hoy, el mismo día del vencimiento.
      rentals.find.mockResolvedValue([
        makeRental({
          id: 'r1',
          nextMaintenanceAt: new Date('2026-10-03T03:59:59Z'),
        }),
      ]);
      plans({ 'user-a': activePlan() });

      await cron.generateDueMaintenanceOrders(NOW);

      expect(ordersService.create).toHaveBeenCalledTimes(1);
    });

    it('programa la visita para el día de Nueva York, no para el día UTC', async () => {
      // 22:00 EDT del 2 de octubre = 02:00Z del 3. "Hoy" para el negocio sigue
      // siendo el 2: con toISOString la visita caería programada para mañana.
      rentals.find.mockResolvedValue([makeRental({ id: 'r1' })]);
      plans({ 'user-a': activePlan() });

      await cron.generateDueMaintenanceOrders(new Date('2026-10-03T02:00:00Z'));

      const opts = ordersService.create.mock.calls[0][2];
      expect(opts.scheduledDeliveryDate).toBe('2026-10-02');
    });
  });

  describe('una visita por usuario', () => {
    it('con dos bebederos vencidos crea UNA sola orden y la enlaza a los dos', async () => {
      rentals.find.mockResolvedValue([
        makeRental({ id: 'r1', userId: 'user-a' }),
        makeRental({
          id: 'r2',
          userId: 'user-a',
          nextMaintenanceAt: new Date('2026-09-20T15:00:00Z'),
        }),
      ]);
      plans({ 'user-a': activePlan() });

      const result = await cron.generateDueMaintenanceOrders(NOW);

      expect(ordersService.create).toHaveBeenCalledTimes(1);
      expect(rentals.update).toHaveBeenCalledTimes(1);
      const [ids, patch] = rentals.update.mock.calls[0];
      expect([...ids].sort()).toEqual(['r1', 'r2']);
      expect(patch).toEqual({ maintenanceOrderId: 'order-1' });
      expect(result).toEqual({ candidates: 1, created: 1, skipped: 0, failed: 0 });
    });

    it('crea una orden por cada usuario distinto', async () => {
      rentals.find.mockResolvedValue([
        makeRental({ id: 'r1', userId: 'user-a' }),
        makeRental({ id: 'r2', userId: 'user-b' }),
      ]);
      plans({ 'user-a': activePlan(), 'user-b': activePlan() });

      const result = await cron.generateDueMaintenanceOrders(NOW);

      expect(ordersService.create).toHaveBeenCalledTimes(2);
      const owners = ordersService.create.mock.calls.map((c) => c[0].id).sort();
      expect(owners).toEqual(['user-a', 'user-b']);
      expect(result.created).toBe(2);
    });
  });

  describe('idempotencia', () => {
    it('no crea otra visita si el rental ya apunta a una orden abierta', async () => {
      rentals.find.mockResolvedValue([
        makeRental({ id: 'r1', maintenanceOrderId: 'order-open' }),
      ]);
      plans({ 'user-a': activePlan() });
      orders.find.mockResolvedValue([
        { id: 'order-open', status: OrderStatus.CONFIRMED_BY_COLMADO },
      ]);

      const result = await cron.generateDueMaintenanceOrders(NOW);

      expect(ordersService.create).not.toHaveBeenCalled();
      expect(result).toEqual({ candidates: 1, created: 0, skipped: 1, failed: 0 });
    });

    it('carga las órdenes referenciadas en UNA sola consulta', async () => {
      rentals.find.mockResolvedValue([
        makeRental({ id: 'r1', userId: 'user-a', maintenanceOrderId: 'o1' }),
        makeRental({ id: 'r2', userId: 'user-b', maintenanceOrderId: 'o2' }),
      ]);
      plans({ 'user-a': activePlan(), 'user-b': activePlan() });
      orders.find.mockResolvedValue([
        { id: 'o1', status: OrderStatus.QUOTED },
        { id: 'o2', status: OrderStatus.IN_DELIVERY_ROUTE },
      ]);

      await cron.generateDueMaintenanceOrders(NOW);

      expect(orders.find).toHaveBeenCalledTimes(1);
    });

    it('un segundo corrido seguido no crea nada (el primero dejó el enlace)', async () => {
      const r1 = makeRental({ id: 'r1' });
      rentals.find.mockResolvedValue([r1]);
      plans({ 'user-a': activePlan() });
      // Simula la escritura real: update() deja el enlace en la fila, y la orden
      // creada queda abierta.
      rentals.update.mockImplementation(
        async (_ids: string[], patch: Partial<Rental>) => {
          r1.maintenanceOrderId = patch.maintenanceOrderId ?? null;
          return { affected: 1 };
        },
      );
      orders.find.mockImplementation(async () => [
        { id: 'order-1', status: OrderStatus.CONFIRMED_BY_COLMADO },
      ]);

      const first = await cron.generateDueMaintenanceOrders(NOW);
      const second = await cron.generateDueMaintenanceOrders(NOW);

      expect(first.created).toBe(1);
      expect(second).toEqual({ candidates: 1, created: 0, skipped: 1, failed: 0 });
      expect(ordersService.create).toHaveBeenCalledTimes(1);
    });

    it('REGENERA la visita cuando la orden referenciada fue CANCELADA (no ocurrió, sigue vencida)', async () => {
      rentals.find.mockResolvedValue([
        makeRental({ id: 'r1', maintenanceOrderId: 'order-cancelled' }),
      ]);
      plans({ 'user-a': activePlan() });
      orders.find.mockResolvedValue([
        { id: 'order-cancelled', status: OrderStatus.CANCELLED },
      ]);

      const result = await cron.generateDueMaintenanceOrders(NOW);

      expect(ordersService.create).toHaveBeenCalledTimes(1);
      expect(rentals.update).toHaveBeenCalledWith(['r1'], {
        maintenanceOrderId: 'order-1',
      });
      expect(result.created).toBe(1);
    });

    it('si cualquiera de los bebederos del usuario tiene visita abierta, no se crea otra', async () => {
      // Una visita cubre todos los bebederos del usuario (resetMaintenanceForUser
      // los reinicia juntos): un r2 sin enlace no justifica una segunda orden.
      rentals.find.mockResolvedValue([
        makeRental({ id: 'r1', maintenanceOrderId: 'order-open' }),
        makeRental({ id: 'r2', maintenanceOrderId: null }),
      ]);
      plans({ 'user-a': activePlan() });
      orders.find.mockResolvedValue([
        { id: 'order-open', status: OrderStatus.PENDING_VALIDATION },
      ]);

      await cron.generateDueMaintenanceOrders(NOW);

      expect(ordersService.create).not.toHaveBeenCalled();
    });
  });

  describe('mantenimiento ya pedido sin enlace (a mano, o creado y no enlazado)', () => {
    /**
     * El repo de órdenes atiende dos consultas: la de las visitas ENLAZADAS (por
     * id) y la de mantenimientos ABIERTOS del cliente (por customerId). El mock
     * responde según cuál le llega.
     */
    const routeOrders = (open: Array<{ id: string; customerId: string }>) => {
      orders.find.mockImplementation(
        async (args: { where: { customerId?: unknown } }) =>
          args.where.customerId !== undefined ? open : [],
      );
    };

    it('adopta el mantenimiento abierto del cliente en vez de crear otra visita', async () => {
      // El cliente tocó "Solicitar mantenimiento" antes del deploy: ya hay una
      // visita en camino que el bebedero no conoce. Crear otra = el repartidor
      // va dos veces.
      rentals.find.mockResolvedValue([makeRental({ id: 'r1' })]);
      plans({ 'user-a': activePlan() });
      routeOrders([{ id: 'manual-1', customerId: 'user-a' }]);

      const result = await cron.generateDueMaintenanceOrders(NOW);

      expect(ordersService.create).not.toHaveBeenCalled();
      expect(rentals.update).toHaveBeenCalledWith(['r1'], {
        maintenanceOrderId: 'manual-1',
      });
      expect(result).toEqual({ candidates: 1, created: 0, skipped: 1, failed: 0 });
    });

    it('sólo busca mantenimientos ABIERTOS (ni entregados ni cancelados) de los usuarios sin visita enlazada, en UNA consulta', async () => {
      rentals.find.mockResolvedValue([
        makeRental({ id: 'r1', userId: 'user-a' }),
        makeRental({ id: 'r2', userId: 'user-b' }),
        makeRental({ id: 'r3', userId: 'user-c', maintenanceOrderId: 'o-open' }),
      ]);
      plans({
        'user-a': activePlan(),
        'user-b': activePlan(),
        'user-c': activePlan(),
      });
      orders.find.mockImplementation(
        async (args: { where: { id?: unknown } }) =>
          args.where.id !== undefined
            ? [{ id: 'o-open', status: OrderStatus.CONFIRMED_BY_COLMADO }]
            : [],
      );

      await cron.generateDueMaintenanceOrders(NOW);

      const openQueries = orders.find.mock.calls.filter(
        ([args]) => args.where.customerId !== undefined,
      );
      expect(openQueries).toHaveLength(1);
      const where = openQueries[0][0].where;
      // user-c ya tiene su visita enlazada y abierta: no se le busca nada.
      expect([...where.customerId.value].sort()).toEqual(['user-a', 'user-b']);
      expect(where.status.type).toBe('not');
      // FindOperator.value de un Not(In([...])) ya devuelve el array interno.
      expect([...where.status.value].sort()).toEqual(
        [OrderStatus.CANCELLED, OrderStatus.DELIVERED].sort(),
      );
      expect(where.items).toEqual({ product: { isMaintenanceService: true } });
    });

    it('a los demás usuarios les sigue creando su visita', async () => {
      rentals.find.mockResolvedValue([
        makeRental({ id: 'r1', userId: 'user-a' }),
        makeRental({ id: 'r2', userId: 'user-b' }),
      ]);
      plans({ 'user-a': activePlan(), 'user-b': activePlan() });
      routeOrders([{ id: 'manual-1', customerId: 'user-a' }]);

      const result = await cron.generateDueMaintenanceOrders(NOW);

      expect(ordersService.create).toHaveBeenCalledTimes(1);
      expect(ordersService.create.mock.calls[0][0].id).toBe('user-b');
      expect(result).toEqual({ candidates: 2, created: 1, skipped: 1, failed: 0 });
    });
  });

  describe('robustez', () => {
    it('un create() que falla no frena a los demás usuarios', async () => {
      rentals.find.mockResolvedValue([
        makeRental({ id: 'r1', userId: 'user-a' }),
        makeRental({ id: 'r2', userId: 'user-b' }),
        makeRental({ id: 'r3', userId: 'user-c' }),
      ]);
      plans({
        'user-a': activePlan(),
        'user-b': activePlan(),
        'user-c': activePlan(),
      });
      ordersService.create.mockImplementation(async (user: { id: string }) => {
        if (user.id === 'user-b') throw new Error('CREDIT_OVERDUE');
        return { id: `order-for-${user.id}` };
      });

      const result = await cron.generateDueMaintenanceOrders(NOW);

      expect(result).toEqual({ candidates: 3, created: 2, skipped: 0, failed: 1 });
      // Al que falló NO se le enlaza nada: seguirá "debido" y se reintenta.
      const linked = rentals.update.mock.calls.map((c) => c[0]);
      expect(linked).toEqual([['r1'], ['r3']]);
    });

    it('si falla el enlace después de crear la orden, el lote sigue', async () => {
      rentals.find.mockResolvedValue([
        makeRental({ id: 'r1', userId: 'user-a' }),
        makeRental({ id: 'r2', userId: 'user-b' }),
      ]);
      plans({ 'user-a': activePlan(), 'user-b': activePlan() });
      rentals.update.mockRejectedValueOnce(new Error('db down'));

      const result = await cron.generateDueMaintenanceOrders(NOW);

      expect(ordersService.create).toHaveBeenCalledTimes(2);
      expect(rentals.update).toHaveBeenCalledTimes(2);
      expect(result.created).toBe(2);
    });

    it('sin producto de mantenimiento disponible devuelve ceros y no toca nada', async () => {
      products.findOne.mockResolvedValue(null);

      const result = await cron.generateDueMaintenanceOrders(NOW);

      expect(result).toEqual({ candidates: 0, created: 0, skipped: 0, failed: 0 });
      expect(rentals.find).not.toHaveBeenCalled();
      expect(ordersService.create).not.toHaveBeenCalled();
    });

    it('busca el producto de servicio DISPONIBLE', async () => {
      await cron.generateDueMaintenanceOrders(NOW);

      expect(products.findOne).toHaveBeenCalledWith({
        where: { isMaintenanceService: true, isAvailable: true },
      });
    });

    it('sin rentals vencidos no consulta planes ni crea nada', async () => {
      const result = await cron.generateDueMaintenanceOrders(NOW);

      expect(result).toEqual({ candidates: 0, created: 0, skipped: 0, failed: 0 });
      expect(subscriptions.resolvePlanRowsByUserIds).not.toHaveBeenCalled();
    });
  });

  describe('disparadores', () => {
    afterEach(() => {
      jest.useRealTimers();
    });

    it('runDaily corre el generador y nunca tira', async () => {
      const spy = jest
        .spyOn(cron, 'generateDueMaintenanceOrders')
        .mockRejectedValue(new Error('boom'));

      await expect(cron.runDaily()).resolves.toBeUndefined();
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it('no pisa un corrido en curso: el segundo disparo simultáneo se descarta', async () => {
      // Boot + las 8:00 pueden coincidir; dos corridas a la vez crearían dos
      // visitas para el mismo usuario antes de que la primera deje el enlace.
      let release: (v: unknown) => void = () => undefined;
      const spy = jest
        .spyOn(cron, 'generateDueMaintenanceOrders')
        .mockImplementation(
          () =>
            new Promise((resolve) => {
              release = resolve;
            }),
        );

      const first = cron.runDaily();
      await cron.runDaily(); // descartado mientras el primero sigue corriendo
      expect(spy).toHaveBeenCalledTimes(1);

      release({ candidates: 0, created: 0, skipped: 0, failed: 0 });
      await first;

      // Ya terminó: el siguiente disparo vuelve a correr.
      spy.mockResolvedValue({ candidates: 0, created: 0, skipped: 0, failed: 0 });
      await cron.runDaily();
      expect(spy).toHaveBeenCalledTimes(2);
    });

    it('al arrancar corre una vez en segundo plano, con demora, sin bloquear el boot', () => {
      jest.useFakeTimers();
      // Dentro del horario de negocio (8:00 AM NY): el corrido de arranque sólo
      // se ejecuta de día, así que el test fija el reloj en vez de depender de
      // la hora real en que corra la suite.
      jest.setSystemTime(NOW);
      const spy = jest
        .spyOn(cron, 'generateDueMaintenanceOrders')
        .mockResolvedValue({ candidates: 0, created: 0, skipped: 0, failed: 0 });

      cron.onApplicationBootstrap();
      // El boot vuelve ya, sin esperar al generador.
      expect(spy).not.toHaveBeenCalled();

      jest.advanceTimersByTime(60_000);
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it('cerrar la app cancela el corrido de arranque pendiente', () => {
      jest.useFakeTimers();
      jest.setSystemTime(NOW);
      const spy = jest
        .spyOn(cron, 'generateDueMaintenanceOrders')
        .mockResolvedValue({ candidates: 0, created: 0, skipped: 0, failed: 0 });

      cron.onApplicationBootstrap();
      cron.onModuleDestroy();
      jest.advanceTimersByTime(60_000);

      expect(spy).not.toHaveBeenCalled();
    });

    describe('corrido de arranque sólo en horario de negocio', () => {
      // Un deploy cae a cualquier hora: a las 22:00 de Nueva York el corrido de
      // arranque programaría visitas "para hoy" y le mandaría push y WhatsApp al
      // cliente de noche. Fuera de 7:00–19:59 NY se omite y lo cubre el cron de
      // las 8:00 AM.
      const SUMMARY = { candidates: 0, created: 0, skipped: 0, failed: 0 };

      it('fuera de horario (22:00 NY) NO genera órdenes y lo deja dicho en el log', () => {
        jest.useFakeTimers();
        // 2026-10-03T02:00:00Z = 22:00 EDT del 2 de octubre.
        jest.setSystemTime(new Date('2026-10-03T02:00:00Z'));
        const spy = jest
          .spyOn(cron, 'generateDueMaintenanceOrders')
          .mockResolvedValue(SUMMARY);
        const log = jest.spyOn(
          (cron as unknown as { logger: Logger }).logger,
          'log',
        );

        cron.onApplicationBootstrap();
        jest.advanceTimersByTime(60_000);

        expect(spy).not.toHaveBeenCalled();
        expect(log).toHaveBeenCalledWith(
          expect.stringContaining('8:00'),
        );
      });

      it('de madrugada (03:00 NY) tampoco corre', () => {
        jest.useFakeTimers();
        // 07:00Z = 03:00 EDT.
        jest.setSystemTime(new Date('2026-10-02T07:00:00Z'));
        const spy = jest
          .spyOn(cron, 'generateDueMaintenanceOrders')
          .mockResolvedValue(SUMMARY);

        cron.onApplicationBootstrap();
        jest.advanceTimersByTime(60_000);

        expect(spy).not.toHaveBeenCalled();
      });

      it('dentro de horario (19:30 NY) SÍ genera las órdenes', () => {
        jest.useFakeTimers();
        // 2026-10-02T23:30:00Z = 19:30 EDT.
        jest.setSystemTime(new Date('2026-10-02T23:30:00Z'));
        const spy = jest
          .spyOn(cron, 'generateDueMaintenanceOrders')
          .mockResolvedValue(SUMMARY);

        cron.onApplicationBootstrap();
        jest.advanceTimersByTime(60_000);

        expect(spy).toHaveBeenCalledTimes(1);
      });

      it('la ventana se evalúa al DISPARAR el timer, no al arrancar (30 s después)', () => {
        jest.useFakeTimers();
        // Arranca a las 19:59:50 NY (23:59:50Z) y el timer dispara 30 s después,
        // ya a las 20:00:20: fuera de horario.
        jest.setSystemTime(new Date('2026-10-02T23:59:50Z'));
        const spy = jest
          .spyOn(cron, 'generateDueMaintenanceOrders')
          .mockResolvedValue(SUMMARY);

        cron.onApplicationBootstrap();
        jest.advanceTimersByTime(60_000);

        expect(spy).not.toHaveBeenCalled();
      });

      it('el cron de las 8:00 (runDaily) NO depende de la ventana: corre siempre', async () => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date('2026-10-03T02:00:00Z')); // 22:00 NY
        const spy = jest
          .spyOn(cron, 'generateDueMaintenanceOrders')
          .mockResolvedValue(SUMMARY);

        await cron.runDaily();

        expect(spy).toHaveBeenCalledTimes(1);
      });
    });
  });
});

/**
 * `isWithinBootWindow` — ventana de 7:00 a 19:59 de Nueva York para el corrido
 * de arranque. Los instantes son UTC explícitos y la zona va fijada en el Intl
 * del helper: pasa igual con TZ=UTC (CI) que en la Mac (UTC-4).
 */
describe('isWithinBootWindow', () => {
  // Octubre = EDT (UTC-4): 06:59 NY = 10:59Z.
  it.each([
    ['06:59 NY → fuera', '2026-10-02T10:59:00Z', false],
    ['07:00 NY → dentro', '2026-10-02T11:00:00Z', true],
    ['12:00 NY → dentro', '2026-10-02T16:00:00Z', true],
    ['19:59 NY → dentro', '2026-10-02T23:59:00Z', true],
    ['20:00 NY → fuera', '2026-10-03T00:00:00Z', false],
    ['medianoche NY → fuera', '2026-10-03T04:00:00Z', false],
  ])('%s', (_label, iso, expected) => {
    expect(isWithinBootWindow(new Date(iso))).toBe(expected);
  });

  it('usa la hora de Nueva York, no la UTC: 23:30Z es 19:30 NY → dentro', () => {
    // En UTC serían las 23:30 (fuera de 7–19); en NY son las 19:30.
    expect(isWithinBootWindow(new Date('2026-10-02T23:30:00Z'))).toBe(true);
  });

  it('usa la hora de Nueva York, no la UTC: 00:30Z es 20:30 NY → fuera', () => {
    // En UTC serían las 00:30; en NY son las 20:30 del día anterior.
    expect(isWithinBootWindow(new Date('2026-10-03T00:30:00Z'))).toBe(false);
  });

  it('respeta el horario de invierno (EST, UTC-5): 12:00Z = 07:00 NY → dentro, 11:59Z = 06:59 → fuera', () => {
    expect(isWithinBootWindow(new Date('2026-12-02T12:00:00Z'))).toBe(true);
    expect(isWithinBootWindow(new Date('2026-12-02T11:59:00Z'))).toBe(false);
  });

  it('acepta otra zona fijada explícitamente', () => {
    // 2026-10-02T12:00Z es mediodía en UTC → dentro; en Tokio (UTC+9) 21:00 → fuera.
    expect(isWithinBootWindow(new Date('2026-10-02T12:00:00Z'), 'UTC')).toBe(true);
    expect(
      isWithinBootWindow(new Date('2026-10-02T12:00:00Z'), 'Asia/Tokyo'),
    ).toBe(false);
  });
});
