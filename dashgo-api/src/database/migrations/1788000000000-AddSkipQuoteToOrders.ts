import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Persists whether an order was created as skip-cotización (every item
 * requiresQuote=false → auto-quoted at creation, $0 shipping). Read later by
 * the auto-confirm path: a paid/confirmed skip-quote order advances straight to
 * CONFIRMED_BY_COLMADO without an admin review step.
 *
 * We persist a dedicated flag instead of inferring from `shipping = 0`, because
 * subscribers also get $0 shipping on NORMAL (admin-quoted) orders — inferring
 * from shipping would wrongly auto-confirm those.
 */
export class AddSkipQuoteToOrders1788000000000 implements MigrationInterface {
  name = 'AddSkipQuoteToOrders1788000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "orders" ADD "skip_quote" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN "skip_quote"`);
  }
}
