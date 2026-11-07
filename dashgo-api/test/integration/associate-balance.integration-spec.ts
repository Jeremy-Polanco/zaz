/**
 * Integration spec — libro de saldo del asociado contra Postgres REAL.
 *
 * POR QUÉ real: la garantía central (dos checkouts a la vez no pueden dejar el
 * saldo en negativo) depende del `SELECT ... FOR UPDATE` sobre la fila del
 * usuario; un mock no puede probar un lock. El spec comparte la base con el
 * resto, así que limpia en afterAll todo lo que commitea.
 */
import { DataSource } from 'typeorm';
import {
  destroyTestDataSource,
  getTestDataSource,
} from '../../src/test-utils/db';
import { makeOrder, makeUser } from '../../src/test-utils/fixtures';
import {
  AssociateBalanceEntry,
  AssociateBalanceEntryType,
  Order,
  PoolDistribution,
  User,
} from '../../src/entities';
import { UserRole } from '../../src/entities/enums';
import { AssociateBalanceService } from '../../src/modules/pool/associate-balance.service';

describe('AssociateBalanceService', () => {
  let ds: DataSource;
  let svc: AssociateBalanceService;
  let assoc: User;
  let distribution: PoolDistribution;
  let orders: Order[];
  const [orderA, orderB, orderC, orderD] = [0, 1, 2, 3];
  // Asociados/órdenes de los tests de checkout concurrente; se limpian en afterAll.
  const extraUserIds: string[] = [];
  const extraOrderIds: string[] = [];

  beforeAll(async () => {
    ds = await getTestDataSource();
    svc = new AssociateBalanceService(ds.getRepository(AssociateBalanceEntry));

    assoc = await ds
      .getRepository(User)
      .save(
        ds.getRepository(User).create(makeUser({ role: UserRole.ASSOCIATE })),
      );
    orders = [];
    for (let i = 0; i < 4; i++) {
      orders.push(
        await ds
          .getRepository(Order)
          .save(
            ds
              .getRepository(Order)
              .create(makeOrder({ customerId: assoc.id }) as Partial<Order>),
          ),
      );
    }
    // Trimestre de los 1990: nunca choca con un reparto real o de otro spec.
    distribution = await ds.getRepository(PoolDistribution).save(
      ds.getRepository(PoolDistribution).create({
        quarter: '1990-Q1',
        totalCents: 1000,
        associateCount: 1,
        shareCents: 1000,
        remainderCents: 0,
      }),
    );
    await ds.getRepository(AssociateBalanceEntry).save(
      ds.getRepository(AssociateBalanceEntry).create({
        userId: assoc.id,
        type: AssociateBalanceEntryType.ALLOCATION,
        amountCents: 1000,
        distributionId: distribution.id,
      }),
    );
  });

  afterAll(async () => {
    // Borrar al usuario arrastra su libro (ON DELETE CASCADE); el reparto
    // sintético se borra después porque el libro lo referencia.
    if (extraOrderIds.length) {
      await ds.getRepository(Order).delete(extraOrderIds);
    }
    if (extraUserIds.length) await ds.getRepository(User).delete(extraUserIds);
    await ds.getRepository(User).delete(assoc.id);
    await ds.getRepository(Order).delete(orders.map((o) => o.id));
    await ds.getRepository(PoolDistribution).delete(distribution.id);
    await destroyTestDataSource();
  });

  it('el canje consume solo lo aplicado y el resto queda', async () => {
    await ds.transaction((tx) =>
      svc.redeem(assoc.id, orders[orderA].id, 300, tx),
    );
    expect(await svc.getBalanceCents(assoc.id)).toBe(700);
  });

  it('un monto <= 0 no hace nada', async () => {
    await ds.transaction((tx) =>
      svc.redeem(assoc.id, orders[orderB].id, 0, tx),
    );
    expect(await svc.getBalanceCents(assoc.id)).toBe(700);
  });

  it('no deja canjear más que el saldo', async () => {
    await expect(
      ds.transaction((tx) => svc.redeem(assoc.id, orders[orderB].id, 701, tx)),
    ).rejects.toMatchObject({ response: { code: 'INSUFFICIENT_BALANCE' } });
    expect(await svc.getBalanceCents(assoc.id)).toBe(700);
  });

  it('dos canjes en paralelo no dejan el saldo negativo', async () => {
    // Determinista: la primera transacción canjea y NO commitea hasta que la
    // segunda ya arrancó. Sin el lock de la fila del usuario, la segunda lee
    // el saldo viejo (700, no ve lo no commiteado) y ambas pasan; con el lock
    // espera, y al commitear la primera ve 200 y se rechaza.
    let firstRedeemed!: () => void;
    const redeemed = new Promise<void>((r) => (firstRedeemed = r));
    const first = ds.transaction(async (tx) => {
      await svc.redeem(assoc.id, orders[orderC].id, 500, tx);
      firstRedeemed();
      await new Promise((r) => setTimeout(r, 400));
    });
    await redeemed;
    const second = ds.transaction((tx) =>
      svc.redeem(assoc.id, orders[orderD].id, 500, tx),
    );
    const results = await Promise.allSettled([first, second]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results[1]).toMatchObject({
      status: 'rejected',
      reason: { response: { code: 'INSUFFICIENT_BALANCE' } },
    });
    expect(await svc.getBalanceCents(assoc.id)).toBe(200);
  });

  it('revertir devuelve el saldo una sola vez', async () => {
    const first = await ds.transaction((tx) =>
      svc.reverseForOrder(orders[orderA].id, tx),
    );
    const second = await ds.transaction((tx) =>
      svc.reverseForOrder(orders[orderA].id, tx),
    );
    expect(first).toBe(300);
    expect(second).toBe(0);
    expect(await svc.getBalanceCents(assoc.id)).toBe(500);
  });

  it('revertir una orden sin canje devuelve 0', async () => {
    const amount = await ds.transaction((tx) =>
      svc.reverseForOrder(orders[orderB].id, tx),
    );
    expect(amount).toBe(0);
  });

  it('el historial viene en orden descendente con el trimestre cargado', async () => {
    const history = await svc.getHistory(assoc.id);
    const allocation = history.find(
      (e) => e.type === AssociateBalanceEntryType.ALLOCATION,
    );
    expect(allocation?.distribution?.quarter).toBe('1990-Q1');
    const times = history.map((e) => e.createdAt.getTime());
    expect([...times].sort((a, b) => b - a)).toEqual(times);
  });

  // Imita el checkout real: la orden se INSERTA en la misma transacción antes de
  // canjear (el FK order_id la exige). Insertar la orden toma FOR KEY SHARE
  // sobre la fila del usuario (FK orders.customer_id); si el lock del canje
  // fuera FOR UPDATE, dos checkouts del mismo asociado se bloquearían entre sí
  // al "subir" el lock y Postgres abortaría uno con 40P01 (deadlock).
  describe('checkouts concurrentes (orden insertada antes de canjear)', () => {
    async function freshAssociate(balanceCents: number): Promise<User> {
      const user = await ds
        .getRepository(User)
        .save(
          ds.getRepository(User).create(makeUser({ role: UserRole.ASSOCIATE })),
        );
      extraUserIds.push(user.id);
      await ds.getRepository(AssociateBalanceEntry).save(
        ds.getRepository(AssociateBalanceEntry).create({
          userId: user.id,
          type: AssociateBalanceEntryType.ALLOCATION,
          amountCents: balanceCents,
          distributionId: null,
        }),
      );
      return user;
    }

    // Dos checkouts en paralelo; la barrera garantiza que AMBOS ya insertaron su
    // orden (y retienen KEY SHARE) antes de que cualquiera pida el lock.
    function parallelCheckouts(userId: string, amountCents: number) {
      let arrived = 0;
      let release!: () => void;
      const bothInserted = new Promise<void>((r) => (release = r));
      const checkout = () =>
        ds.transaction(async (tx) => {
          const order = await tx.save(
            Order,
            tx.create(
              Order,
              makeOrder({ customerId: userId }) as Partial<Order>,
            ),
          );
          extraOrderIds.push(order.id);
          if (++arrived === 2) release();
          await bothInserted;
          await svc.redeem(userId, order.id, amountCents, tx);
        });
      return Promise.allSettled([checkout(), checkout()]);
    }

    it('si el saldo alcanza para ambos, los dos pasan sin deadlock', async () => {
      const user = await freshAssociate(1000);
      const results = await parallelCheckouts(user.id, 300);
      expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled']);
      expect(await svc.getBalanceCents(user.id)).toBe(400);
    });

    it('si el saldo alcanza para uno solo, el otro se rechaza limpio (no 40P01)', async () => {
      const user = await freshAssociate(500);
      const results = await parallelCheckouts(user.id, 300);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const rejected = results.find((r) => r.status === 'rejected') as
        | PromiseRejectedResult
        | undefined;
      expect(rejected?.reason).toMatchObject({
        response: { code: 'INSUFFICIENT_BALANCE' },
      });
      expect(await svc.getBalanceCents(user.id)).toBe(200);
    });
  });

  it('borrar al asociado borra su libro', async () => {
    const temp = await ds
      .getRepository(User)
      .save(
        ds.getRepository(User).create(makeUser({ role: UserRole.ASSOCIATE })),
      );
    await ds.getRepository(AssociateBalanceEntry).save(
      ds.getRepository(AssociateBalanceEntry).create({
        userId: temp.id,
        type: AssociateBalanceEntryType.ALLOCATION,
        amountCents: 50,
        distributionId: null,
      }),
    );
    await ds.getRepository(User).delete(temp.id);
    const rows = await ds
      .getRepository(AssociateBalanceEntry)
      .count({ where: { userId: temp.id } });
    expect(rows).toBe(0);
  });
});
