import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Propina (tip) — chosen at checkout for DIGITAL orders only (15/18/25% of the
 * product subtotal, or none). Untaxed: it is added AFTER tax and included in
 * total_amount, so the Stripe hold/capture picks it up without changes to the
 * payment flow. Cash orders never store a tip (tipping happens in person).
 *
 * The invoice snapshots the tip like every other monetary field.
 */
export class AddTipToOrdersAndInvoices1798000000000
  implements MigrationInterface
{
  name = 'AddTipToOrdersAndInvoices1798000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "orders" ADD "tip" numeric(10,2) NOT NULL DEFAULT '0'`,
    );
    await queryRunner.query(
      `ALTER TABLE "invoices" ADD "tip" numeric(10,2) NOT NULL DEFAULT '0'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "invoices" DROP COLUMN "tip"`);
    await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN "tip"`);
  }
}
