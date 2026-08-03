import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Rol vendedor.
 *
 * Agrega 'seller' a `users_role_enum` y `users.seller_id` — el vendedor que
 * tiene asignado a ese cliente. Un cliente tiene UN vendedor (1:N y no N:M a
 * propósito: comercialmente es así, y migrar a pivote después es barato).
 *
 * NO se usa `ALTER TYPE ... ADD VALUE`: en Postgres un valor recién agregado no
 * se puede USAR dentro de la misma transacción que lo agregó, y TypeORM corre
 * las migraciones en una transacción — reventaría con "unsafe use of new value
 * of enum type", y solo al deployar. Además `ADD VALUE` no tiene vuelta atrás
 * (no existe DROP VALUE). El baile de renombrar el tipo es transaccional y sí
 * tiene `down()`.
 */
export class AddSellerRole1801000000000 implements MigrationInterface {
  name = 'AddSellerRole1801000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TYPE "public"."users_role_enum" RENAME TO "users_role_enum_old";
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
    await queryRunner.query(`DROP TYPE "public"."users_role_enum_old";`);

    await queryRunner.query(`
      ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "seller_id" uuid;
    `);
    // ON DELETE SET NULL: si se borra el vendedor, sus clientes quedan sin
    // asignar, nunca se borran.
    await queryRunner.query(`
      ALTER TABLE "users"
        DROP CONSTRAINT IF EXISTS "FK_users_seller_id";
    `);
    await queryRunner.query(`
      ALTER TABLE "users"
        ADD CONSTRAINT "FK_users_seller_id"
        FOREIGN KEY ("seller_id") REFERENCES "users"("id") ON DELETE SET NULL;
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_users_seller_id"
        ON "users" ("seller_id") WHERE "seller_id" IS NOT NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_users_seller_id";`);
    await queryRunner.query(`
      ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "FK_users_seller_id";
    `);
    await queryRunner.query(`
      ALTER TABLE "users" DROP COLUMN IF EXISTS "seller_id";
    `);
    // Cualquier usuario que ya sea 'seller' vuelve a 'client' — si no, el cast
    // al enum viejo falla y el revert queda trabado.
    await queryRunner.query(`
      UPDATE "users" SET "role" = 'client' WHERE "role" = 'seller';
    `);
    await queryRunner.query(`
      ALTER TYPE "public"."users_role_enum" RENAME TO "users_role_enum_new";
    `);
    await queryRunner.query(`
      CREATE TYPE "public"."users_role_enum" AS ENUM(
        'client', 'promoter', 'super_admin_delivery'
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
