/**
 * Jest globalTeardown for the integration test project.
 *
 * Runs ONCE after all integration specs complete.
 * Closes the shared test DataSource to avoid connection leaks.
 */

export default async function globalTeardown(): Promise<void> {
  try {
    // The shared DataSource from test-utils/db.ts is destroyed here.
    // We dynamically require it to avoid the circular import issue that
    // would arise if globalSetup already reset the module registry.
    const { destroyTestDataSource } = await import(
      '../src/test-utils/db'
    );
    await destroyTestDataSource();
    console.log('[integration-teardown] Test DataSource closed.');
  } catch {
    // Not fatal — the process will exit anyway.
    console.warn('[integration-teardown] Could not close test DataSource (may already be closed).');
  }
}
