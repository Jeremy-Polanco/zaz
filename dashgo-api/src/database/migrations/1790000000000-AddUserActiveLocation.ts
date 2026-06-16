import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds `users.active_location_id` — a pointer to the `UserAddress` a user is
 * currently operating from. Primary use: a repartidor (SUPER_ADMIN_DELIVERY)
 * who dispatches from multiple locations selects the active one, which becomes
 * the shipping origin (see ShippingService.getOrigin).
 *
 * FK references user_addresses(id) with ON DELETE SET NULL so deleting the
 * active address simply clears the pointer (the user then falls back to their
 * default address). Nullable — existing users start with no explicit selection.
 */
export class AddUserActiveLocation1790000000000 implements MigrationInterface {
  name = 'AddUserActiveLocation1790000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
        ADD COLUMN IF NOT EXISTS "active_location_id" uuid NULL;
    `);
    await queryRunner.query(`
      ALTER TABLE "users"
        ADD CONSTRAINT "fk_users_active_location"
        FOREIGN KEY ("active_location_id")
        REFERENCES "user_addresses"("id")
        ON DELETE SET NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
        DROP CONSTRAINT IF EXISTS "fk_users_active_location";
    `);
    await queryRunner.query(`
      ALTER TABLE "users"
        DROP COLUMN IF EXISTS "active_location_id";
    `);
  }
}
