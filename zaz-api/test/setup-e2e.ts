/**
 * Jest globalSetup for the e2e test project.
 *
 * Same as setup-integration.ts but ensures the test DB credentials
 * are set to zaz_test (matching docker-compose.test.yml defaults)
 * BEFORE loading .env.test, so loadEnvTest() cannot override them.
 *
 * Runs ONCE before all e2e specs:
 * 1. Force zaz_test credentials (Docker container defaults).
 * 2. Verify Docker Postgres is reachable on port 5433.
 * 3. Drop the public schema and recreate it (clean slate).
 * 4. Run all TypeORM migrations.
 */

import * as net from 'net';
import * as path from 'path';
import * as fs from 'fs';
import { DataSource } from 'typeorm';

function checkDockerReachable(): Promise<void> {
  const host = process.env.DB_HOST ?? 'localhost';
  const port = parseInt(process.env.DB_PORT ?? '5433', 10);

  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    const timer = setTimeout(() => {
      socket.destroy();
      reject(
        new Error(
          `E2ESetup: Docker daemon unreachable on tcp://${host}:${port}.\n` +
            'Run: docker compose -f test/docker-compose.test.yml up -d\n' +
            'and wait for the healthcheck to pass before running e2e tests.',
        ),
      );
    }, 5000);

    socket.connect(port, host, () => {
      clearTimeout(timer);
      socket.destroy();
      resolve();
    });

    socket.on('error', (err) => {
      clearTimeout(timer);
      socket.destroy();
      reject(
        new Error(
          `E2ESetup: Docker daemon unreachable on tcp://${host}:${port}.\n` +
            `  Original error: ${err.message}\n` +
            'Run: docker compose -f test/docker-compose.test.yml up -d\n' +
            'and wait for the healthcheck to pass before running e2e tests.',
        ),
      );
    });
  });
}

export default async function globalSetup(): Promise<void> {
  // Force correct test DB credentials before .env.test can override them
  process.env.DB_HOST = process.env.DB_HOST ?? 'localhost';
  process.env.DB_PORT = process.env.DB_PORT ?? '5433';
  process.env.DB_USER = 'zaz_test';
  process.env.DB_PASSWORD = 'zaz_test';
  process.env.DB_NAME = 'zaz_test';
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'test-secret-32-characters-long-xxx';
  process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY ?? 'sk_test_dummy';
  process.env.STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET ?? 'whsec_test';
  process.env.STRIPE_SUBSCRIPTION_PRICE_ID = process.env.STRIPE_SUBSCRIPTION_PRICE_ID ?? 'price_test_monthly';

  // Fail fast if Docker Postgres is not reachable
  await checkDockerReachable();

  // Build a DataSource for schema setup + migrations
  const ds = new DataSource({
    type: 'postgres',
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT, 10),
    username: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    entities: [],
    synchronize: false,
    migrationsRun: false,
    migrations: [path.resolve(__dirname, '../src/database/migrations/*.ts')],
    logging: false,
  });

  await ds.initialize();

  try {
    // Drop and recreate public schema (clean slate for each full test run)
    await ds.query('DROP SCHEMA public CASCADE');
    await ds.query('CREATE SCHEMA public');
    await ds.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
    await ds.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');

    // Run all migrations
    await ds.runMigrations({ transaction: 'each' });
    console.log('[e2e-setup] Migrations applied successfully.');
  } finally {
    await ds.destroy();
  }
}
