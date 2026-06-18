import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from '../app.module';
import { OrdersService } from '../modules/orders/orders.service';

/**
 * One-time backfill — auto-confirm free-shipping orders that were already stuck
 * in QUOTED ("Por confirmar") before the auto-confirm feature shipped.
 *
 * Reuses the exact production logic (OrdersService.tryAutoConfirmFreeOrder via
 * backfillAutoConfirmFreeShippingOrders), so the same guardrails apply: only
 * cash / $0 / fully-credited free-shipping orders are confirmed, stock is
 * decremented transactionally, and failures are non-blocking. Idempotent — safe
 * to re-run (confirmed orders are no longer QUOTED and get skipped).
 *
 * Run:  npm run backfill:auto-confirm
 */
async function run() {
  const logger = new Logger('BackfillAutoConfirm');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  try {
    const orders = app.get(OrdersService);
    const { scanned, confirmed } =
      await orders.backfillAutoConfirmFreeShippingOrders();
    logger.log(
      `Backfill complete — scanned ${scanned} QUOTED order(s), auto-confirmed ${confirmed}.`,
    );
  } finally {
    await app.close();
  }
}

run().catch((err) => {
  console.error('Backfill auto-confirm failed:', err);
  process.exit(1);
});
