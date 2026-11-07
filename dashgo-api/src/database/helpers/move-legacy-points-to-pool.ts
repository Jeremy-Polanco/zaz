// CONGELADO: esta migración ya está aplicada. Este archivo lo importa la
// migración 1814000000000, así que cambiarlo cambia lo que esa migración hace
// en cualquier base nueva. Tratalo como congelado: el comportamiento nuevo va
// en un helper o una migración nueva.
/**
 * Mueve al pool los puntos sin usar de los clientes (paso 4 de la migración
 * AssociatePointsPool1814000000000).
 *
 * Vive FUERA de `src/database/migrations/` a propósito: TypeORM carga todo lo
 * que exporta cada archivo de esa carpeta y trata cada función exportada como
 * una clase de migración (`new fn()`), así que exportar esto desde el archivo
 * de la migración revienta el arranque con "someClass is not a constructor".
 */

type SqlRunner = {
  query: (sql: string, params?: unknown[]) => Promise<unknown>;
};

// Mismo filtro en el INSERT y en el UPDATE para que muevan exactamente las
// mismas filas. Los vencidos (por fecha, aunque el cron todavía no los haya
// marcado 'expired') quedan fuera: ya no son plata viva del cliente y meterlos
// al pool inflaría lo que se reparte a los asociados.
const LIVE_LEGACY_POINTS = `
  "type" = 'earned'
  AND "status" IN ('pending', 'claimable')
  AND "amount_cents" > 0
  AND ("expires_at" IS NULL OR "expires_at" > now())
`;

/**
 * Pasa al pool los puntos ganados que el cliente aún no usó ni perdió.
 *
 * Idempotente: el UPDATE los saca de 'pending'/'claimable', así que una segunda
 * corrida (redeploy, re-run manual) no encuentra nada. El NOT EXISTS cubre el
 * caso raro de que el INSERT haya quedado hecho y el UPDATE no.
 */
export async function moveLegacyPointsToPool(runner: SqlRunner): Promise<void> {
  // El trimestre es el de NY (donde opera el negocio), no el del servidor.
  await runner.query(`
    INSERT INTO "pool_contributions"
      ("quarter", "amount_cents", "source", "source_user_id", "legacy_points_entry_id")
    SELECT
      to_char(now() AT TIME ZONE 'America/New_York', 'YYYY-"Q"Q'),
      p."amount_cents",
      'legacy_migration',
      p."user_id",
      p."id"
    FROM "points_ledger_entries" p
    WHERE ${LIVE_LEGACY_POINTS}
      AND NOT EXISTS (
        SELECT 1 FROM "pool_contributions" c
        WHERE c."legacy_points_entry_id" = p."id"
      )
  `);
  await runner.query(`
    UPDATE "points_ledger_entries" SET "status" = 'pooled'
    WHERE ${LIVE_LEGACY_POINTS}
  `);
}
