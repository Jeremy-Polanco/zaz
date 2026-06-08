import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Makes `orders.delivery_address` nullable.
 *
 * New model: the customer-facing app no longer collects a delivery address —
 * customers just place the order. The super-admin captures and sets the
 * location at delivery time (PATCH /orders/:id/delivery-address) and saves it
 * to the customer's address book. So an order can exist without an address.
 */
export class MakeOrderDeliveryAddressOptional1782000000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "orders"
        ALTER COLUMN "delivery_address" DROP NOT NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Backfill any nulls before restoring the NOT NULL constraint, or the
    // ALTER would fail on existing address-less orders.
    await queryRunner.query(`
      UPDATE "orders"
        SET "delivery_address" = '{"text":""}'::jsonb
        WHERE "delivery_address" IS NULL;
    `);
    await queryRunner.query(`
      ALTER TABLE "orders"
        ALTER COLUMN "delivery_address" SET NOT NULL;
    `);
  }
}
