import { defineConfig, devices } from '@playwright/test'

/**
 * Playwright E2E configuration for dashgo-web.
 *
 * Tests assume the full stack is running:
 *   - dashgo-api on http://localhost:3002/api (postgres seeded)
 *   - dashgo-web (vite dev) on http://localhost:5173
 *
 * Start the stack with:
 *   POSTGRES_HOST_PORT=5434 API_HOST_PORT=3002 docker compose --env-file /dev/null up -d
 *   docker exec dashgo-api npm run seed
 *   pnpm dev   # in dashgo-web
 *
 * Then run: pnpm test:e2e
 */

const WEB_URL = process.env.E2E_WEB_URL ?? 'http://localhost:5173'
const API_URL = process.env.E2E_API_URL ?? 'http://localhost:3002/api'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false, // The OTP rate limiter + shared seed user state make parallelism flaky.
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: WEB_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 10_000,
    extraHTTPHeaders: {
      'X-DashGo-E2E': '1',
    },
  },
  expect: {
    timeout: 8_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  // Restart the api container so each run starts with a clean throttler.
  globalSetup: './e2e/global-setup.ts',
  metadata: {
    WEB_URL,
    API_URL,
  },
})
