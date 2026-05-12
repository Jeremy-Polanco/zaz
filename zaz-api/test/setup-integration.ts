/**
 * Jest globalSetup for the integration test project.
 *
 * Runs ONCE before all integration specs:
 * 1. Verify Docker Postgres is reachable on port 5433.
 * 2. Check that migration files exist (fail-fast on missing InitialSchema).
 * 3. Drop the public schema and recreate it (clean slate).
 * 4. Run all TypeORM migrations.
 *
 * Assumptions:
 * - docker compose -f test/docker-compose.test.yml up -d has been run.
 * - .env.test is loaded (via dotenv or jest globalSetup env file).
 */

import * as net from 'net';
import * as path from 'path';
import * as fs from 'fs';
import { DataSource } from 'typeorm';

// Load .env.test if present (before building DataSource)
function loadEnvTest(): void {
  const envTestPath = path.resolve(__dirname, '../.env.test');
  if (!fs.existsSync(envTestPath)) return;
  const lines = fs.readFileSync(envTestPath, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx < 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

function checkMigrations(): void {
  const migrationsDir = path.resolve(
    __dirname,
    '../src/database/migrations',
  );

  let files: string[] = [];
  try {
    files = fs.readdirSync(migrationsDir);
  } catch {
    throw new Error(
      `IntegrationSetup: Migration directory not found: ${migrationsDir}\n` +
        'Run: npm run migration:generate -- src/database/migrations/InitialSchema\n' +
        'against your dev DB and commit the result before running integration tests.',
    );
  }

  const hasMigrations = files.some(
    (f) => f.endsWith('.ts') || f.endsWith('.js'),
  );
  if (!hasMigrations) {
    throw new Error(
      'IntegrationSetup: InitialSchema migration is missing. ' +
        'No migration files found in src/database/migrations/.\n' +
        'Run: npm run migration:generate -- src/database/migrations/InitialSchema\n' +
        'against your dev DB and commit the result before running integration tests.',
    );
  }
}

function checkDockerReachable(): Promise<void> {
  const host = process.env.DB_HOST ?? 'localhost';
  const port = parseInt(process.env.DB_PORT ?? '5433', 10);

  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    const timer = setTimeout(() => {
      socket.destroy();
      reject(
        new Error(
          `IntegrationSetup: Docker daemon unreachable on tcp://${host}:${port}.\n` +
            'Run: docker compose -f test/docker-compose.test.yml up -d\n' +
            'and wait for the healthcheck to pass before running integration tests.',
        ),
      );
    }, 3000);

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
          `IntegrationSetup: Docker daemon unreachable on tcp://${host}:${port}.\n` +
            `  Original error: ${err.message}\n` +
            'Run: docker compose -f test/docker-compose.test.yml up -d\n' +
            'and wait for the healthcheck to pass before running integration tests.',
        ),
      );
    });
  });
}

export default async function globalSetup(): Promise<void> {
  // Force correct test DB credentials BEFORE loadEnvTest() so .env.test cannot
  // override them with non-Docker values (e.g. colmapp_test from a dev .env.test).
  process.env.DB_HOST = 'localhost';
  process.env.DB_PORT = '5433';
  process.env.DB_USER = 'zaz_test';
  process.env.DB_PASSWORD = 'zaz_test';
  process.env.DB_NAME = 'zaz_test';
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'test-secret-32-characters-long-xxx';
  process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY ?? 'sk_test_dummy';
  process.env.STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET ?? 'whsec_test';
  process.env.STRIPE_SUBSCRIPTION_PRICE_ID = process.env.STRIPE_SUBSCRIPTION_PRICE_ID ?? 'price_test_monthly';

  loadEnvTest();

  // 1. Fail fast if no migration files
  checkMigrations();

  // 2. Fail fast if Docker Postgres is not reachable
  await checkDockerReachable();

  // 3. Build a DataSource with ts-node migrations path
  const ds = new DataSource({
    type: 'postgres',
    host: process.env.DB_HOST ?? 'localhost',
    port: parseInt(process.env.DB_PORT ?? '5433', 10),
    username: process.env.DB_USER ?? 'zaz_test',
    password: process.env.DB_PASSWORD ?? 'zaz_test',
    database: process.env.DB_NAME ?? 'zaz_test',
    // No entities needed for schema drop + migration run
    entities: [],
    synchronize: false,
    migrationsRun: false,
    migrations: [path.resolve(__dirname, '../src/database/migrations/*.ts')],
    logging: false,
  });

  await ds.initialize();

  try {
    // 4. Drop and recreate public schema (clean slate for each full test run)
    await ds.query('DROP SCHEMA public CASCADE');
    await ds.query('CREATE SCHEMA public');
    await ds.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
    await ds.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');

    // 5. Run all migrations
    await ds.runMigrations({ transaction: 'each' });
    console.log('[integration-setup] Migrations applied successfully.');
  } finally {
    await ds.destroy();
  }
}
