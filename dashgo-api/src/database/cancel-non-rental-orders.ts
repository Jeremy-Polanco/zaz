import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from '../app.module';
import { OrdersService } from '../modules/orders/orders.service';
import { OrderStatus } from '../entities/enums';

/**
 * One-time op — soft-delete (cancel) every order that is NOT linked to a rental,
 * keeping the rental-triggering orders. Reuses the production cancel path
 * (OrdersService.cancelNonRentalOrders → cancelOrderWithReversals), so applied
 * credit is refunded, redeemed points restored, and decremented stock put back.
 * The "alquiler" (rentals) themselves are a separate entity and are never
 * touched — deleting their originating order only nulls rental.order_id.
 *
 * SAFE BY DEFAULT: runs as a DRY RUN (reports the breakdown by status, writes
 * nothing). Pass --apply to actually cancel. Optionally narrow with
 * --status=quoted,pending_quote (comma-separated OrderStatus values).
 *
 *   npm run cancel:non-rental                         # dry run — review first
 *   npm run cancel:non-rental -- --apply              # cancel ALL non-rental orders
 *   npm run cancel:non-rental -- --apply --status=quoted,pending_quote
 */
async function run() {
  const logger = new Logger('CancelNonRentalOrders');
  const apply = process.argv.includes('--apply');
  const statusArg = process.argv.find((a) => a.startsWith('--status='));
  const statuses = statusArg
    ? (statusArg
        .split('=')[1]
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean) as OrderStatus[])
    : undefined;

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  try {
    const orders = app.get(OrdersService);
    const result = await orders.cancelNonRentalOrders({
      dryRun: !apply,
      statuses,
    });

    logger.log(
      apply
        ? 'APPLIED — non-rental orders cancelled (status is soft/reversible; invoices preserved).'
        : 'DRY RUN — nothing written. Review the breakdown below, then re-run with --apply.',
    );
    logger.log(JSON.stringify(result, null, 2));
    if (!apply) {
      logger.log(
        'To cancel: npm run cancel:non-rental -- --apply   (optionally --status=quoted,pending_quote)',
      );
    }
  } finally {
    await app.close();
  }
}

run().catch((err) => {
  console.error('cancel-non-rental-orders failed:', err);
  process.exit(1);
});
