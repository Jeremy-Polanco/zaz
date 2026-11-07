import { MigrationInterface, QueryRunner } from 'typeorm';
import { moveLegacyPointsToPool } from '../helpers/move-legacy-points-to-pool';

/**
 * Rol asociado y pool trimestral de puntos.
 *
 * Los puntos dejan de ser del cliente: alimentan un pool que cada trimestre se
 * reparte en partes iguales entre los usuarios con rol `associate`. Esta
 * migración deja el esquema (rol, estado 'pooled' del ledger y las tres tablas
 * del pool) y mueve al pool los puntos que los clientes tenían sin usar.
 *
 * NO se usa `ALTER TYPE ... ADD VALUE` (ver AddSellerRole1801000000000): un
 * valor recién agregado no se puede usar en la misma transacción que lo agregó
 * — y esta migración usa 'pooled' enseguida, en el UPDATE de los puntos — y
 * además `ADD VALUE` no tiene vuelta atrás. El baile de renombrar el tipo es
 * transaccional y sí tiene `down()`.
 */
export class AssociatePointsPool1814000000000 implements MigrationInterface {
  name = 'AssociatePointsPool1814000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. users.role += 'associate'
    await queryRunner.query(`
      ALTER TYPE "public"."users_role_enum" RENAME TO "users_role_enum_old";
    `);
    await queryRunner.query(`
      CREATE TYPE "public"."users_role_enum" AS ENUM(
        'client', 'promoter', 'seller', 'associate', 'super_admin_delivery'
      );
    `);
    await queryRunner.query(`
      ALTER TABLE "users" ALTER COLUMN "role" DROP DEFAULT;
    `);
    await queryRunner.query(`
      ALTER TABLE "users"
        ALTER COLUMN "role" TYPE "public"."users_role_enum"
        USING "role"::text::"public"."users_role_enum";
    `);
    await queryRunner.query(`
      ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'client';
    `);
    await queryRunner.query(`DROP TYPE "public"."users_role_enum_old";`);

    // 2. points_ledger_entries.status += 'pooled' (la columna no tiene default
    //    ni índices que dependan del tipo).
    await queryRunner.query(`
      ALTER TYPE "public"."points_ledger_entries_status_enum"
        RENAME TO "points_ledger_entries_status_enum_old";
    `);
    await queryRunner.query(`
      CREATE TYPE "public"."points_ledger_entries_status_enum" AS ENUM(
        'pending', 'claimable', 'redeemed', 'expired', 'pooled'
      );
    `);
    await queryRunner.query(`
      ALTER TABLE "points_ledger_entries"
        ALTER COLUMN "status" TYPE "public"."points_ledger_entries_status_enum"
        USING "status"::text::"public"."points_ledger_entries_status_enum";
    `);
    await queryRunner.query(
      `DROP TYPE "public"."points_ledger_entries_status_enum_old";`,
    );

    // 3. Tablas del pool.
    // source_user_id es ON DELETE SET NULL: borrar la cuenta de un cliente no
    // puede achicar un pool que ya se recaudó.
    await queryRunner.query(`
      CREATE TABLE "pool_contributions" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "quarter" varchar(7) NOT NULL,
        "amount_cents" integer NOT NULL,
        "source" varchar(20) NOT NULL,
        "order_id" uuid,
        "source_user_id" uuid,
        "legacy_points_entry_id" uuid,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_pool_contributions" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_pool_contributions_amount" CHECK ("amount_cents" > 0),
        CONSTRAINT "FK_pool_contributions_order"
          FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL,
        CONSTRAINT "FK_pool_contributions_source_user"
          FOREIGN KEY ("source_user_id") REFERENCES "users"("id") ON DELETE SET NULL
      );
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_pool_contributions_quarter"
        ON "pool_contributions" ("quarter");
    `);
    // Una orden aporta una sola vez (webhooks y reintentos).
    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_pool_contributions_order"
        ON "pool_contributions" ("order_id") WHERE "source" = 'order';
    `);

    // UNIQUE en quarter: impide repartir dos veces el mismo trimestre.
    await queryRunner.query(`
      CREATE TABLE "pool_distributions" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "quarter" varchar(7) NOT NULL,
        "total_cents" integer NOT NULL,
        "associate_count" integer NOT NULL,
        "share_cents" integer NOT NULL,
        "remainder_cents" integer NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_pool_distributions" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_pool_distributions_quarter" UNIQUE ("quarter")
      );
    `);

    await queryRunner.query(`
      CREATE TABLE "associate_balance_entries" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "user_id" uuid NOT NULL,
        "type" varchar(20) NOT NULL,
        "amount_cents" integer NOT NULL,
        "distribution_id" uuid,
        "order_id" uuid,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_associate_balance_entries" PRIMARY KEY ("id"),
        CONSTRAINT "FK_associate_balance_user"
          FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_associate_balance_distribution"
          FOREIGN KEY ("distribution_id") REFERENCES "pool_distributions"("id"),
        CONSTRAINT "FK_associate_balance_order"
          FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL
      );
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_associate_balance_entries_user"
        ON "associate_balance_entries" ("user_id");
    `);
    // Un reparto le da una sola parte a cada asociado.
    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_associate_balance_allocation"
        ON "associate_balance_entries" ("distribution_id", "user_id")
        WHERE "type" = 'allocation';
    `);
    // Una orden descuenta saldo una vez y lo devuelve una vez.
    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_associate_balance_redemption"
        ON "associate_balance_entries" ("order_id") WHERE "type" = 'redemption';
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_associate_balance_reversal"
        ON "associate_balance_entries" ("order_id") WHERE "type" = 'reversal';
    `);

    // 4. Los puntos sin usar de los clientes pasan al pool.
    await moveLegacyPointsToPool(queryRunner);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Los puntos 'pooled' vuelven al cliente: 'claimable' si ya era canjeable
    // y 'pending' si no. Se restauran TODOS los 'pooled' y no solo los de
    // `legacy_points_entry_id`: aunque después de esta migración otro camino
    // marque puntos como 'pooled', si quedara alguno el cast al enum viejo
    // fallaría y el revert quedaría trabado.
    await queryRunner.query(`
      UPDATE "points_ledger_entries"
        SET "status" = CASE
          WHEN "claimable_at" IS NOT NULL AND "claimable_at" <= now()
            THEN 'claimable'::"public"."points_ledger_entries_status_enum"
          ELSE 'pending'::"public"."points_ledger_entries_status_enum"
        END
      WHERE "status" = 'pooled';
    `);
    // Los asociados vuelven a 'client' — si no, el cast al enum viejo falla.
    await queryRunner.query(`
      UPDATE "users" SET "role" = 'client' WHERE "role" = 'associate';
    `);

    await queryRunner.query(`DROP TABLE "associate_balance_entries";`);
    await queryRunner.query(`DROP TABLE "pool_distributions";`);
    await queryRunner.query(`DROP TABLE "pool_contributions";`);

    await queryRunner.query(`
      ALTER TYPE "public"."points_ledger_entries_status_enum"
        RENAME TO "points_ledger_entries_status_enum_new";
    `);
    await queryRunner.query(`
      CREATE TYPE "public"."points_ledger_entries_status_enum" AS ENUM(
        'pending', 'claimable', 'redeemed', 'expired'
      );
    `);
    await queryRunner.query(`
      ALTER TABLE "points_ledger_entries"
        ALTER COLUMN "status" TYPE "public"."points_ledger_entries_status_enum"
        USING "status"::text::"public"."points_ledger_entries_status_enum";
    `);
    await queryRunner.query(
      `DROP TYPE "public"."points_ledger_entries_status_enum_new";`,
    );

    await queryRunner.query(`
      ALTER TYPE "public"."users_role_enum" RENAME TO "users_role_enum_new";
    `);
    await queryRunner.query(`
      CREATE TYPE "public"."users_role_enum" AS ENUM(
        'client', 'promoter', 'seller', 'super_admin_delivery'
      );
    `);
    await queryRunner.query(`
      ALTER TABLE "users" ALTER COLUMN "role" DROP DEFAULT;
    `);
    await queryRunner.query(`
      ALTER TABLE "users"
        ALTER COLUMN "role" TYPE "public"."users_role_enum"
        USING "role"::text::"public"."users_role_enum";
    `);
    await queryRunner.query(`
      ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'client';
    `);
    await queryRunner.query(`DROP TYPE "public"."users_role_enum_new";`);
  }
}
