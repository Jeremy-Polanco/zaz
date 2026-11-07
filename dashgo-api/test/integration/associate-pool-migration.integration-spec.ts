/**
 * Integration spec — migración del pool de puntos para asociados, contra
 * Postgres REAL.
 *
 * POR QUÉ existe: la migración mueve plata (los puntos sin usar de los clientes
 * pasan al pool) y la lógica vive en SQL, así que un mock no la prueba. El
 * globalSetup ya corrió `up()` sobre una tabla vacía; acá se siembran filas
 * "legacy" y se llama directo a `moveLegacyPointsToPool`, que además tiene que
 * ser idempotente (un redeploy o un re-run no puede duplicar aportes).
 *
 * Todo se guarda commiteado (no hay rollback por test): la limpieza es manual
 * en `afterAll` y se hace por usuario, porque la base es compartida.
 */
import { DataSource } from 'typeorm';
import {
  destroyTestDataSource,
  getTestDataSource,
} from '../../src/test-utils/db';
import { makeUser } from '../../src/test-utils/fixtures';
import { UserRole } from '../../src/entities/enums';
import { User } from '../../src/entities';
import { quarterOf } from '../../src/modules/pool/quarter';
import { moveLegacyPointsToPool } from '../../src/database/helpers/move-legacy-points-to-pool';

describe('AssociatePointsPool migration', () => {
  let ds: DataSource;
  let userId: string;

  const insertEntry = (
    type: string,
    status: string,
    amount: number,
    expiresAt: string | null,
  ) =>
    ds.query(
      `INSERT INTO points_ledger_entries (user_id, type, status, amount_cents, expires_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [userId, type, status, amount, expiresAt],
    );

  beforeAll(async () => {
    ds = await getTestDataSource();
    const user = await ds.getRepository(User).save(makeUser());
    userId = user.id;

    await insertEntry('earned', 'pending', 100, null);
    await insertEntry('earned', 'claimable', 250, null);
    // Vencido por fecha aunque siga 'claimable': no es plata viva, no va al pool.
    await insertEntry('earned', 'claimable', 70, '2020-01-01T00:00:00Z');
    await insertEntry('earned', 'redeemed', 30, null);
    await insertEntry('expired', 'expired', -40, null);
  });

  afterAll(async () => {
    await ds.query(`DELETE FROM pool_contributions WHERE source_user_id = $1`, [
      userId,
    ]);
    await ds.query(`DELETE FROM points_ledger_entries WHERE user_id = $1`, [
      userId,
    ]);
    await ds.query(`DELETE FROM users WHERE id = $1`, [userId]);
    await destroyTestDataSource();
  });

  it('mueve al pool solo los puntos vivos y es idempotente', async () => {
    const runner = ds.createQueryRunner();
    try {
      await moveLegacyPointsToPool(runner);

      const rows = await ds.query(
        `SELECT amount_cents, source, source_user_id, legacy_points_entry_id, quarter
           FROM pool_contributions WHERE source_user_id = $1 ORDER BY amount_cents`,
        [userId],
      );
      expect(rows.map((r: { amount_cents: number }) => r.amount_cents)).toEqual(
        [100, 250],
      );
      expect(
        rows.every((r: { source: string }) => r.source === 'legacy_migration'),
      ).toBe(true);
      expect(
        rows.every(
          (r: { legacy_points_entry_id: string | null }) =>
            r.legacy_points_entry_id !== null,
        ),
      ).toBe(true);
      expect(rows[0].quarter).toBe(quarterOf(new Date()));

      const statuses = await ds.query(
        `SELECT amount_cents, status FROM points_ledger_entries
          WHERE user_id = $1 ORDER BY amount_cents`,
        [userId],
      );
      expect(statuses).toEqual([
        { amount_cents: -40, status: 'expired' },
        { amount_cents: 30, status: 'redeemed' },
        { amount_cents: 70, status: 'claimable' },
        { amount_cents: 100, status: 'pooled' },
        { amount_cents: 250, status: 'pooled' },
      ]);

      await moveLegacyPointsToPool(runner);
      const again = await ds.query(
        `SELECT 1 FROM pool_contributions WHERE source_user_id = $1`,
        [userId],
      );
      expect(again.length).toBe(2);
    } finally {
      await runner.release();
    }
  });

  it("el enum de roles acepta 'associate'", async () => {
    await ds.query(`UPDATE users SET role = 'associate' WHERE id = $1`, [
      userId,
    ]);
    const [row] = await ds.query(`SELECT role FROM users WHERE id = $1`, [
      userId,
    ]);
    expect(row.role).toBe(UserRole.ASSOCIATE);
  });
});
