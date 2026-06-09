import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds a `building` column to user_addresses — the building / house / unit
 * number the repartidor records when pinning a delivery location, so future
 * trips know exactly where to go. The order's deliveryAddress is JSONB
 * (GeoAddress) and needs no schema change.
 */
export class AddAddressBuilding1784000000000 implements MigrationInterface {
  name = 'AddAddressBuilding1784000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "user_addresses" ADD COLUMN "building" varchar(120);`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "user_addresses" DROP COLUMN IF EXISTS "building";`,
    );
  }
}
