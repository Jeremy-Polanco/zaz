import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Generaliza las comisiones de "promotor" a "quien gana" (earner), para que
 * vendedores y promotores compartan UNA sola verdad sobre cuánta plata se debe.
 *
 * Duplicar la maquinaria en tablas paralelas daría dos respuestas distintas a
 * "¿cuánto le debo a esta persona?", y ninguna confiable.
 *
 * Cambios:
 *  - `promoter_commission_entries` → `commission_entries`
 *  - `promoter_id` → `earner_id` (en asientos y en payouts)
 *  - `earner_role` nuevo: todo lo existente queda en 'promoter'
 *  - `payment_method` nuevo en los asientos: snapshot de cómo pagó el cliente.
 *    Tarjeta y efectivo NO son la misma deuda — con tarjeta la plata entró a
 *    la empresa y se le debe la comisión completa; en efectivo alguien ya
 *    agarró los billetes. Un solo total mezclado hace pagar de más.
 */
export class GeneralizeCommissionsToEarner1803000000000
  implements MigrationInterface
{
  name = 'GeneralizeCommissionsToEarner1803000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "promoter_commission_entries" RENAME TO "commission_entries";
    `);
    await queryRunner.query(`
      ALTER TABLE "commission_entries" RENAME COLUMN "promoter_id" TO "earner_id";
    `);
    await queryRunner.query(`
      ALTER TABLE "commission_entries"
        ADD COLUMN IF NOT EXISTS "earner_role" character varying(20) NOT NULL DEFAULT 'promoter';
    `);
    await queryRunner.query(`
      ALTER TABLE "commission_entries"
        ADD CONSTRAINT "CHK_commission_entries_earner_role"
        CHECK ("earner_role" IN ('promoter', 'seller'));
    `);
    // Nullable: los asientos históricos no saben cómo se pagó la orden, y
    // inventarles un método sería peor que admitir que no se sabe.
    await queryRunner.query(`
      ALTER TABLE "commission_entries"
        ADD COLUMN IF NOT EXISTS "payment_method" character varying(16);
    `);
    // Backfill desde la orden cuando existe — así los asientos viejos también
    // se pueden separar por tarjeta/efectivo.
    await queryRunner.query(`
      UPDATE "commission_entries" ce
        SET "payment_method" = o."payment_method"::text
        FROM "orders" o
        WHERE ce."order_id" = o."id" AND ce."payment_method" IS NULL;
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_commission_entries_earner"
        ON "commission_entries" ("earner_id", "earner_role");
    `);

    await queryRunner.query(`
      ALTER TABLE "payouts" RENAME COLUMN "promoter_id" TO "earner_id";
    `);
    await queryRunner.query(`
      ALTER TABLE "payouts"
        ADD COLUMN IF NOT EXISTS "earner_role" character varying(20) NOT NULL DEFAULT 'promoter';
    `);
    await queryRunner.query(`
      ALTER TABLE "payouts"
        ADD CONSTRAINT "CHK_payouts_earner_role"
        CHECK ("earner_role" IN ('promoter', 'seller'));
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "payouts" DROP CONSTRAINT IF EXISTS "CHK_payouts_earner_role";
    `);
    await queryRunner.query(`
      ALTER TABLE "payouts" DROP COLUMN IF EXISTS "earner_role";
    `);
    await queryRunner.query(`
      ALTER TABLE "payouts" RENAME COLUMN "earner_id" TO "promoter_id";
    `);

    await queryRunner.query(`DROP INDEX IF EXISTS "idx_commission_entries_earner";`);
    await queryRunner.query(`
      ALTER TABLE "commission_entries" DROP COLUMN IF EXISTS "payment_method";
    `);
    await queryRunner.query(`
      ALTER TABLE "commission_entries"
        DROP CONSTRAINT IF EXISTS "CHK_commission_entries_earner_role";
    `);
    // Los asientos de vendedores no tienen lugar en el esquema viejo: se
    // borran, si no el revert deja filas que el código anterior leería como
    // comisiones de promotor y pagaría mal.
    await queryRunner.query(`
      DELETE FROM "commission_entries" WHERE "earner_role" = 'seller';
    `);
    await queryRunner.query(`
      ALTER TABLE "commission_entries" DROP COLUMN IF EXISTS "earner_role";
    `);
    await queryRunner.query(`
      ALTER TABLE "commission_entries" RENAME COLUMN "earner_id" TO "promoter_id";
    `);
    await queryRunner.query(`
      ALTER TABLE "commission_entries" RENAME TO "promoter_commission_entries";
    `);
  }
}
