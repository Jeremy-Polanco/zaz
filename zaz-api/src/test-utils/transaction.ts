/**
 * Per-test transaction rollback helper for integration specs.
 *
 * Usage in an integration spec:
 *
 *   let qr: QueryRunner;
 *
 *   beforeAll(async () => {
 *     app = await createTestingApp();
 *     dataSource = app.get(DataSource);
 *   });
 *   afterAll(async () => { await app.close(); });
 *
 *   const { getQueryRunner } = setupTransactionPerTest(() => dataSource);
 *
 *   it('does something', async () => {
 *     const qr = getQueryRunner();
 *     // write entities via qr.manager, service calls go through ds.manager
 *     // which is monkey-patched to redirect to qr.manager
 *   });
 *
 * The monkey-patch replaces ds.manager getter with a getter that returns
 * qr.manager. This means any service that does ds.manager.getRepository(X)
 * will use the query runner's enlisted connection — and all changes will
 * be rolled back in afterEach.
 *
 * IMPORTANT: Services that open their OWN transactions via ds.transaction()
 * will NOT be covered by this rollback because ds.transaction() uses a
 * separate connection. Those flows need manual cleanup or a different approach.
 */

import { DataSource, QueryRunner } from 'typeorm';

export interface TransactionTestContext {
  /** Returns the active QueryRunner for the current test (set in beforeEach) */
  getQueryRunner: () => QueryRunner;
}

/**
 * Registers beforeEach / afterEach hooks that wrap each test in a DB
 * transaction that is rolled back after the test completes.
 *
 * @param getDataSource — factory that returns the DataSource to use.
 *   Called inside beforeEach so it is safe to pass a getter that returns the
 *   DataSource obtained after app bootstrap.
 */
export function setupTransactionPerTest(
  getDataSource: () => DataSource,
): TransactionTestContext {
  let currentQr: QueryRunner | null = null;
  // Store original manager descriptor so we can restore it in afterEach
  let originalManagerDescriptor: PropertyDescriptor | undefined;

  beforeEach(async () => {
    const ds = getDataSource();
    currentQr = ds.createQueryRunner();
    await currentQr.connect();
    await currentQr.startTransaction();

    // Monkey-patch DataSource.manager getter to redirect to qr.manager
    // This makes services that call ds.manager.getRepository() use the TX.
    originalManagerDescriptor = Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(ds),
      'manager',
    );

    const qr = currentQr;
    Object.defineProperty(ds, 'manager', {
      get: () => qr.manager,
      configurable: true,
    });
  });

  afterEach(async () => {
    if (currentQr) {
      const ds = getDataSource();

      // Restore original manager descriptor before rollback
      if (originalManagerDescriptor) {
        Object.defineProperty(ds, 'manager', originalManagerDescriptor);
      } else {
        // If no original descriptor found, delete the own property override
        try {
          delete (ds as unknown as Record<string, unknown>)['manager'];
        } catch {
          // Ignore — not configurable in some environments
        }
      }

      await currentQr.rollbackTransaction();
      await currentQr.release();
      currentQr = null;
    }
  });

  return {
    getQueryRunner: () => {
      if (!currentQr) {
        throw new Error(
          'setupTransactionPerTest: getQueryRunner() called outside of a test context.',
        );
      }
      return currentQr;
    },
  };
}
