/**
 * Integration spec — reparto trimestral del pool entre los asociados.
 *
 * POR QUÉ real: la idempotencia depende de la unicidad de `quarter` y del
 * índice parcial de asignaciones, y la carrera contra una cancelación depende
 * de `FOR UPDATE` en Postgres; nada de eso se prueba con mocks.
 *
 * La base se comparte con el resto de los specs y los asociados son GLOBALES
 * (el reparto cuenta a todos los `role = 'associate'`), así que las
 * expectativas se calculan con la fórmula y `n = others + los míos`, no con
 * literales. Los trimestres son de los 60/90, lejos de cualquier dato real o
 * de otro spec, y todo lo que se commitea se borra en afterAll.
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
import { makeOrder, makeUser } from '../../src/test-utils/fixtures';
import { PoolService } from '../../src/modules/pool/pool.service';
import { AssociateBalanceService } from '../../src/modules/pool/associate-balance.service';
import { quarterStart } from '../../src/modules/pool/quarter';
import {
  AssociateBalanceEntry,
  AssociateBalanceEntryType,
  Order,
  PoolContribution,
  PoolContributionSource,
  PoolDistribution,
  User,
} from '../../src/entities';
import { OrderStatus, UserRole } from '../../src/entities/enums';

// Todos los trimestres que este spec toca o a los que arrastra (carryover).
const QUARTERS = [
  '1950-Q1',
  '1950-Q2',
  '1960-Q2',
  '1965-Q3',
  '1965-Q4',
  '1966-Q1',
  '1996-Q1',
  '1996-Q2',
  '1997-Q1',
  '1997-Q2',
  '1998-Q1',
  '1998-Q2',
  '1999-Q1',
  '1999-Q2',
  '1999-Q3',
  '1999-Q4',
];

// La misma cuenta que debe hacer el servicio.
const split = (total: number, n: number) =>
  n === 0
    ? { share: 0, remainder: total }
    : { share: Math.floor(total / n), remainder: total % n };

describe('Reparto trimestral del pool (integración)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let pool: PoolService;
  let balance: AssociateBalanceService;
  let others = 0; // asociados que NO son de este spec
  let associates: User[] = [];
  let client: User;
  let seller: User;
  let exAssociate: User;
  const userIds: string[] = [];
  const orderIds: string[] = [];

  async function seedUser(role: UserRole): Promise<User> {
    const user = await ds
      .getRepository(User)
      .save(ds.getRepository(User).create(makeUser({ role }) as Partial<User>));
    userIds.push(user.id);
    return user;
  }

  const seedContribution = (
    quarter: string,
    amountCents: number,
    extra: Partial<PoolContribution> = {},
  ) =>
    ds.getRepository(PoolContribution).save(
      ds.getRepository(PoolContribution).create({
        quarter,
        amountCents,
        source: PoolContributionSource.LEGACY_MIGRATION,
        ...extra,
      }),
    );

  const countAssociates = () =>
    ds.getRepository(User).count({ where: { role: UserRole.ASSOCIATE } });

  const allocationsOf = (quarter: string) =>
    ds
      .getRepository(AssociateBalanceEntry)
      .createQueryBuilder('e')
      .innerJoin(PoolDistribution, 'd', 'd.id = e.distribution_id')
      .where('d.quarter = :quarter', { quarter })
      .andWhere('e.type = :type', { type: AssociateBalanceEntryType.ALLOCATION })
      .getMany();

  beforeAll(async () => {
    app = await createTestingApp();
    ds = app.get(DataSource);
    pool = app.get(PoolService);
    balance = app.get(AssociateBalanceService);

    for (let i = 0; i < 3; i++) {
      associates.push(await seedUser(UserRole.ASSOCIATE));
    }
    client = await seedUser(UserRole.CLIENT);
    seller = await seedUser(UserRole.SELLER);
    // Fue asociado y cobró antes; ahora es cliente: conserva lo previo y no cobra más.
    exAssociate = await seedUser(UserRole.CLIENT);
    await ds.getRepository(AssociateBalanceEntry).save(
      ds.getRepository(AssociateBalanceEntry).create({
        userId: exAssociate.id,
        type: AssociateBalanceEntryType.ALLOCATION,
        amountCents: 500,
        distributionId: null,
      }),
    );
    others = (await countAssociates()) - associates.length;
  });

  afterAll(async () => {
    if (ds?.isInitialized) {
      // Borrar usuarios arrastra su libro (CASCADE); luego los repartos, que el
      // libro referenciaba, y por último los aportes de los trimestres usados.
      if (userIds.length) await ds.getRepository(User).delete(userIds);
      await ds
        .createQueryBuilder()
        .delete()
        .from(PoolDistribution)
        .where('quarter IN (:...q)', { q: QUARTERS })
        .execute();
      await ds
        .createQueryBuilder()
        .delete()
        .from(PoolContribution)
        .where('quarter IN (:...q)', { q: QUARTERS })
        .execute();
      if (orderIds.length) await ds.getRepository(Order).delete(orderIds);
    }
    if (app) await app.close();
  });

  it('reparte en partes iguales y arrastra los centavos', async () => {
    await seedContribution('1999-Q3', 10001);
    const n = others + associates.length;
    const { share, remainder } = split(10001, n);

    const d = await pool.distributeQuarter('1999-Q3');

    expect(d).toMatchObject({
      quarter: '1999-Q3',
      totalCents: 10001,
      associateCount: n,
      shareCents: share,
      remainderCents: remainder,
    });
    // En una base limpia (others = 0) son los literales del diseño.
    if (others === 0) expect({ share, remainder }).toEqual({ share: 3333, remainder: 2 });
    for (const a of associates) {
      expect(await balance.getBalanceCents(a.id)).toBe(share);
    }
    expect(await allocationsOf('1999-Q3')).toHaveLength(n);
    expect(await pool.getPoolCents('1999-Q4')).toBe(remainder);
    const carry = await ds
      .getRepository(PoolContribution)
      .find({ where: { quarter: '1999-Q4' } });
    if (remainder > 0) {
      expect(carry).toHaveLength(1);
      expect(carry[0].source).toBe(PoolContributionSource.CARRYOVER);
    }
  });

  it('un cliente, un vendedor y un ex-asociado no cobran', async () => {
    // Se apoya en el reparto de '1999-Q3' del test anterior: solo cobran los
    // que son asociados AL MOMENTO del reparto.
    expect(await balance.getBalanceCents(client.id)).toBe(0);
    expect(await balance.getBalanceCents(seller.id)).toBe(0);
    // El ex-asociado conserva lo previo, sin parte nueva.
    expect(await balance.getBalanceCents(exAssociate.id)).toBe(500);
    const rows = await allocationsOf('1999-Q3');
    const paid = new Set(rows.map((r) => r.userId));
    for (const u of [client, seller, exAssociate]) expect(paid.has(u.id)).toBe(false);
  });

  it('menos centavos que asociados: no hay asignaciones de 0, todo se arrastra', async () => {
    const n = others + associates.length;
    // Con menos centavos que asociados el reparto da 0 por cabeza.
    const total = Math.max(1, n - 1);
    await seedContribution('1999-Q1', total);

    const d = await pool.distributeQuarter('1999-Q1');

    expect(d).toMatchObject({
      totalCents: total,
      associateCount: n,
      shareCents: 0,
      remainderCents: total,
    });
    expect(await allocationsOf('1999-Q1')).toHaveLength(0);
    expect(await pool.getPoolCents('1999-Q2')).toBe(total);
  });

  it('sin asociados el pool entero pasa al trimestre siguiente', async () => {
    await seedContribution('1996-Q1', 100);
    // Si hay asociados de otros specs no se puede llegar a 0: se asierta la fórmula.
    await ds
      .getRepository(User)
      .update(associates.map((a) => a.id), { role: UserRole.CLIENT });
    try {
      const d = await pool.distributeQuarter('1996-Q1');
      const { share, remainder } = split(100, others);
      expect(d).toMatchObject({
        associateCount: others,
        shareCents: share,
        remainderCents: remainder,
      });
      if (others === 0) {
        expect(remainder).toBe(100);
        expect(await allocationsOf('1996-Q1')).toHaveLength(0);
      }
      expect(await pool.getPoolCents('1996-Q2')).toBe(remainder);
    } finally {
      await ds
        .getRepository(User)
        .update(associates.map((a) => a.id), { role: UserRole.ASSOCIATE });
    }
  });

  it('es un único reparto aunque corra dos veces a la vez', async () => {
    await seedContribution('1998-Q1', 1000);
    const n = others + associates.length;

    const [a, b] = await Promise.all([
      pool.distributeQuarter('1998-Q1'),
      pool.distributeQuarter('1998-Q1'),
    ]);

    expect([a, b].filter(Boolean)).toHaveLength(1);
    expect(
      await ds.getRepository(PoolDistribution).count({ where: { quarter: '1998-Q1' } }),
    ).toBe(1);
    const rows = await allocationsOf('1998-Q1');
    expect(rows).toHaveLength(n);
    // Una sola asignación por asociado, y el carryover una sola vez.
    for (const assoc of associates) {
      expect(rows.filter((r) => r.userId === assoc.id)).toHaveLength(1);
    }
    expect(await pool.getPoolCents('1998-Q2')).toBe(split(1000, n).remainder);
  });

  it('repartir un trimestre ya repartido devuelve null y no cambia nada', async () => {
    const before = await balance.getBalanceCents(associates[0].id);
    expect(await pool.distributeQuarter('1999-Q3')).toBeNull();
    expect(await balance.getBalanceCents(associates[0].id)).toBe(before);
  });

  it('una cancelación que retira un aporte antes de la suma no deja que el reparto lo cuente', async () => {
    const orderRow = await ds.getRepository(Order).save(
      ds
        .getRepository(Order)
        .create(
          makeOrder({ customerId: client.id, status: OrderStatus.DELIVERED }) as Partial<Order>,
        ),
    );
    orderIds.push(orderRow.id);
    await seedContribution('1997-Q1', 1000);
    await seedContribution('1997-Q1', 100, {
      source: PoolContributionSource.ORDER,
      orderId: orderRow.id,
    });

    // La "cancelación" retira el aporte y queda con la transacción abierta.
    const qr = ds.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();
    try {
      expect(await pool.withdrawOrderContribution(orderRow.id, qr.manager)).toBe(100);

      let settled = false;
      const distribution = pool.distributeQuarter('1997-Q1').then((d) => {
        settled = true;
        return d;
      });
      // El reparto tiene que esperar el lock del aporte, no sumarlo ni saltearlo a medias.
      await new Promise((r) => setTimeout(r, 400));
      expect(settled).toBe(false);

      await qr.commitTransaction();
      const d = await distribution;
      expect(d?.totalCents).toBe(1000);
    } finally {
      if (qr.isTransactionActive) await qr.rollbackTransaction();
      await qr.release();
    }
  });

  it('recupera trimestres atrasados en orden e incluye el arrastre', async () => {
    await seedContribution('1965-Q3', 10001);
    await seedContribution('1965-Q4', 500);
    const n = others + associates.length;
    const q3 = split(10001, n);
    const q4 = split(500 + q3.remainder, n);

    // 6 min después del corte: ya pasó la gracia de 5 min.
    const done = await pool.distributeDueQuarters(
      new Date(quarterStart('1966-Q1').getTime() + 6 * 60_000),
    );

    // Otro spec podría haber dejado un trimestre viejo sin repartir: se asierta
    // pertenencia y orden, no igualdad exacta de la lista.
    expect(done).toEqual(expect.arrayContaining(['1965-Q3', '1965-Q4']));
    expect(done.indexOf('1965-Q3')).toBeLessThan(done.indexOf('1965-Q4'));

    const [d3, d4] = await Promise.all([
      ds.getRepository(PoolDistribution).findOneByOrFail({ quarter: '1965-Q3' }),
      ds.getRepository(PoolDistribution).findOneByOrFail({ quarter: '1965-Q4' }),
    ]);
    expect(d3.remainderCents).toBe(q3.remainder);
    // Q4 repartió sus 500 MÁS el arrastre de Q3: por eso Q3 va primero.
    expect(d4.totalCents).toBe(500 + q3.remainder);
    expect(d4.shareCents).toBe(q4.share);
    expect(d4.remainderCents).toBe(q4.remainder);
    expect(await pool.getPoolCents('1966-Q1')).toBe(q4.remainder);
  });

  it('no reparte el trimestre en curso', async () => {
    await seedContribution('1960-Q2', 300);
    const now = quarterStart('1960-Q2');
    try {
      const done = await pool.distributeDueQuarters(now);
      expect(done).not.toContain('1960-Q2');
      expect(
        await ds.getRepository(PoolDistribution).count({ where: { quarter: '1960-Q2' } }),
      ).toBe(0);
    } finally {
      // Se retira para que no lo recoja el catch-up de otros tests/specs.
      await ds.getRepository(PoolContribution).delete({ quarter: '1960-Q2' });
    }
  });

  it('un trimestre solo vence 5 minutos después de terminar (gracia)', async () => {
    // Un aporte calculado justo antes de la medianoche que commitea justo
    // después no debe caer en un trimestre cuyo reparto ya empezó.
    await seedContribution('1950-Q1', 300);
    const end = quarterStart('1950-Q2').getTime();

    const early = await pool.distributeDueQuarters(new Date(end + 60_000));
    expect(early).not.toContain('1950-Q1');
    expect(
      await ds.getRepository(PoolDistribution).count({ where: { quarter: '1950-Q1' } }),
    ).toBe(0);

    const late = await pool.distributeDueQuarters(new Date(end + 6 * 60_000));
    expect(late).toContain('1950-Q1');
    expect(
      await ds.getRepository(PoolDistribution).count({ where: { quarter: '1950-Q1' } }),
    ).toBe(1);
  });

  it('listDistributions devuelve los repartos por trimestre descendente', async () => {
    const list = await pool.listDistributions();
    const quarters = list.map((d) => d.quarter);
    expect(quarters).toEqual([...quarters].sort().reverse());
    expect(quarters).toEqual(expect.arrayContaining(['1999-Q3', '1965-Q4']));
  });
});
