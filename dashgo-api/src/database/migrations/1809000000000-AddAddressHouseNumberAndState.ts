import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * La jurisdicción fiscal pasa a ser la ley, y la dirección pasa a saber dónde
 * está.
 *
 * El problema: hasta acá la tasa colgaba de la ZONA DE REPARTO
 * (`delivery_zones.tax_rate`). La zona es un concepto de logística — la dibuja
 * el dueño con prefijos de ZIP para agrupar el reparto y cobrar distancia — así
 * que partir, renombrar o apagar una zona podía cambiarle el impuesto a un
 * cliente sin que nadie lo decidiera. El impuesto no lo decide el reparto: lo
 * decide el estado donde se entrega.
 *
 * Esta migración hace cuatro cosas, todas en la misma dirección:
 *
 *  1. `user_addresses` aprende `house_number`, `state`, `county` y
 *     `geocoded_at`. El número de puerta lo escribe el cliente (hoy se perdía:
 *     la orden lo guardaba en su snapshot y la libreta no); el estado y el
 *     condado los DERIVA EL SERVIDOR por geocodificación inversa. Nunca los
 *     manda el cliente — si los mandara, el cliente elegiría cuánto impuesto
 *     paga. `geocoded_at` es el SELLO de "acá ya miró el geocoder": sin él, una
 *     dirección que Nominatim ubicó fuera de NJ/NY (y que por eso quedó con
 *     `state` NULL) se re-procesa en cada vuelta del backfill para siempre.
 *  2. Nace `tax_jurisdictions`: una fila por ley, con la cita legal al lado.
 *     Cuando dentro de dos años alguien pregunte por qué a Elizabeth se le
 *     cobró 6.625%, la respuesta está en la base y no en un commit.
 *  3. `delivery_zones.tax_rate` se vuelve NULLABLE y las cuatro zonas sembradas
 *     vuelven a NULL: de fuente de verdad pasa a ser un OVERRIDE deliberado.
 *  4. `orders.tax_jurisdiction` congela QUÉ ley le puso precio al pedido, al
 *     lado de la tasa que ya se congelaba.
 *
 * Las órdenes ya emitidas no se tocan: cada una tiene su `tax_rate` congelada.
 */
export class AddAddressHouseNumberAndState1809000000000
  implements MigrationInterface
{
  name = 'AddAddressHouseNumberAndState1809000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── 1. La dirección aprende dónde está ────────────────────────────────
    // `house_number` 40 y no 10: en Estados Unidos hay "1101-A", "24 1/2" y
    // rangos ("120-05" en Queens es un número de puerta, no un error).
    // `state` son 2 letras (la sigla ISO, 'NJ'/'NY'): es la CLAVE con la que se
    // busca la jurisdicción, no texto para mostrar.
    // `geocoded_at` es timestamptz y NULL por defecto: NULL = "nunca se
    // geocodificó", que es el estado de toda la libreta vieja.
    await queryRunner.query(`
      ALTER TABLE "user_addresses"
        ADD COLUMN IF NOT EXISTS "house_number" character varying(40),
        ADD COLUMN IF NOT EXISTS "state" character varying(2),
        ADD COLUMN IF NOT EXISTS "county" character varying(80),
        ADD COLUMN IF NOT EXISTS "geocoded_at" TIMESTAMP WITH TIME ZONE;
    `);

    // Buscar "todas las direcciones sin geocodificar" es exactamente lo que
    // hace el backfill (`src/database/backfill-address-geo.ts`) en cada vuelta:
    // `state IS NULL AND geocoded_at IS NULL`. El índice parcial es esa consulta
    // tal cual — y se vacía solo a medida que el backfill avanza.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_user_addresses_state"
        ON "user_addresses" ("state");
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_user_addresses_pending_geocode"
        ON "user_addresses" ("created_at")
        WHERE "state" IS NULL AND "geocoded_at" IS NULL;
    `);

    // ── 2. La ley, como tabla ─────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "tax_jurisdictions" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "code" character varying(16) NOT NULL,
        "name" character varying(80) NOT NULL,
        "tax_rate" numeric(6,5) NOT NULL,
        "source" text,
        "is_active" boolean NOT NULL DEFAULT true,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_tax_jurisdictions" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_tax_jurisdictions_code" UNIQUE ("code")
      );
    `);

    // Mismo CHECK que la zona: una fracción negativa devolvería impuesto y un
    // 1.5 por confundir "6.625" con "0.06625" cobraría 150%.
    await queryRunner.query(`
      ALTER TABLE "tax_jurisdictions"
        DROP CONSTRAINT IF EXISTS "CHK_tax_jurisdictions_tax_rate_range";
    `);
    await queryRunner.query(`
      ALTER TABLE "tax_jurisdictions"
        ADD CONSTRAINT "CHK_tax_jurisdictions_tax_rate_range"
        CHECK ("tax_rate" >= 0 AND "tax_rate" < 1);
    `);

    // Las dos jurisdicciones donde repartimos hoy. `source` no es decorativo:
    // es la única forma de auditar el número sin ir a buscarlo de nuevo.
    // Idempotente por `code` — volver a correr la migración no pisa una tasa
    // que alguien haya ajustado a mano.
    await queryRunner.query(`
      INSERT INTO "tax_jurisdictions" ("code", "name", "tax_rate", "source")
      SELECT * FROM (VALUES
        (
          'NJ',
          'New Jersey (estatal, sin impuesto local)',
          0.06625,
          'N.J.S.A. 54:32B-3 — 6.625% estatal desde 2018-01-01, sin impuesto local (la media tasa UEZ de 3.3125% aplica sólo a vendedores certificados en zona UEZ, no a nosotros). El envío se grava en proporción a los bienes gravados (N.J.A.C. 18:24-27.2). Verificado 2026-09-21.'
        ),
        (
          'NYC',
          'New York City (5 condados)',
          0.08875,
          '8.875% = 4% estatal NYS + 4.5% ciudad NYC + 0.375% MCTD, en los cinco condados (New York, Kings, Queens, Bronx, Richmond). El envío se grava en proporción a los bienes gravados (NY TB-ST-838). Verificado 2026-09-21.'
        )
      ) AS seed(code, name, tax_rate, source)
      WHERE NOT EXISTS (
        SELECT 1 FROM "tax_jurisdictions" tj WHERE tj."code" = seed.code
      );
    `);

    // ── 3. La zona deja de ser la fuente de verdad ────────────────────────
    // NULL pasa a significar "no piso nada, cobrá lo que diga la ley". El CHECK
    // de rango se queda: en SQL un CHECK con NULL da UNKNOWN y la fila pasa.
    await queryRunner.query(`
      ALTER TABLE "delivery_zones" ALTER COLUMN "tax_rate" DROP DEFAULT;
    `);
    await queryRunner.query(`
      ALTER TABLE "delivery_zones" ALTER COLUMN "tax_rate" DROP NOT NULL;
    `);
    // Sólo se vacían los valores que ESCRIBIÓ la semilla de la migración 1808
    // (0.06625 / 0.08875). Una tasa que el admin haya cargado a mano después es
    // justamente un override deliberado y no se toca.
    await queryRunner.query(`
      UPDATE "delivery_zones"
        SET "tax_rate" = NULL
        WHERE "tax_rate" IN (0.06625, 0.08875);
    `);

    // ── 4. La orden congela también la LEY ────────────────────────────────
    // Ya congelaba `tax_rate`. Con el código al lado, una auditoría puede decir
    // "este pedido pagó 6.625% porque se entregó en New Jersey" sin tener que
    // adivinar a qué tasa correspondía ese número en esa fecha.
    await queryRunner.query(`
      ALTER TABLE "orders"
        ADD COLUMN IF NOT EXISTS "tax_jurisdiction" character varying(16);
    `);
  }

  /**
   * Revertir 1809 tiene que dejar la base como la dejó 1808, no como estaba
   * antes de 1808: revertir de a una migración es el caso normal.
   *
   * 1808 dejó `delivery_zones.tax_rate` NOT NULL DEFAULT 0.08887 y SEMBRADA por
   * prefijo de ZIP (NJ 0.06625, NYC 0.08875). Si el down() sólo rellenara los
   * NULL con 0.08887, al volver a 1808 —donde la zona SÍ es la fuente de la
   * tasa— todas las zonas cobrarían el fallback histórico: el cliente de
   * Elizabeth volvería a pagar 8.887% en vez de 6.625%, y el del Bronx de
   * menos. Por eso se re-siembra igual que 1808, con el mismo WHERE idempotente
   * (sólo se tocan las que quedaron en el DEFAULT).
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "orders" DROP COLUMN IF EXISTS "tax_jurisdiction";
    `);
    // Se rellenan los NULL ANTES de volver a poner el NOT NULL: si no, el
    // rollback se cae con las zonas que esta migración vació.
    await queryRunner.query(`
      UPDATE "delivery_zones" SET "tax_rate" = 0.08887 WHERE "tax_rate" IS NULL;
    `);
    await queryRunner.query(`
      ALTER TABLE "delivery_zones" ALTER COLUMN "tax_rate" SET DEFAULT 0.08887;
    `);
    await queryRunner.query(`
      ALTER TABLE "delivery_zones" ALTER COLUMN "tax_rate" SET NOT NULL;
    `);
    // --- Y la siembra de 1808, idéntica (New Jersey 6.625%) ---------------
    await queryRunner.query(`
      UPDATE "delivery_zones"
        SET "tax_rate" = 0.06625
        WHERE '0720' = ANY("zip_prefixes")
          AND "tax_rate" = 0.08887;
    `);
    // --- New York City 8.875% --------------------------------------------
    await queryRunner.query(`
      UPDATE "delivery_zones"
        SET "tax_rate" = 0.08875
        WHERE "zip_prefixes" && ARRAY['104','112','100','101','102']::character varying[]
          AND "tax_rate" = 0.08887;
    `);
    await queryRunner.query(`DROP TABLE IF EXISTS "tax_jurisdictions";`);
    await queryRunner.query(`
      DROP INDEX IF EXISTS "idx_user_addresses_pending_geocode";
    `);
    await queryRunner.query(`
      DROP INDEX IF EXISTS "idx_user_addresses_state";
    `);
    await queryRunner.query(`
      ALTER TABLE "user_addresses"
        DROP COLUMN IF EXISTS "house_number",
        DROP COLUMN IF EXISTS "state",
        DROP COLUMN IF EXISTS "county",
        DROP COLUMN IF EXISTS "geocoded_at";
    `);
  }
}
