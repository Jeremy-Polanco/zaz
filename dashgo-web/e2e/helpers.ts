import type { APIRequestContext } from '@playwright/test'
import { expect } from '@playwright/test'

export const API_URL = process.env.E2E_API_URL ?? 'http://localhost:3002/api'

/**
 * Seeded test users (see dashgo-api/src/database/seed.ts). All +1 555-555-xxxx
 * numbers bypass Twilio and log the OTP to the api container's stdout — we
 * read it back via `getDevOtp` below.
 */
export const SEEDED = {
  superAdmin: '+15555550001',
  promoter: '+15555550005',
  client: '+15555550004',
  // María Pérez — credit account "al día". Used by UI tests that need a fresh
  // OTP send to a non-cached phone so they don't trip the 30s cooldown.
  clientAlDia: '+15555550006',
} as const

/**
 * Read the latest dev-mode OTP for `phone` from the API container logs.
 *
 * The API logs OTPs to stdout in dev (no Twilio creds) as:
 *   [DEV SEED OTP] → +15555550001: Tu código DashGo es 123456. Vence en 5 min.
 *
 * Call this AFTER triggering an OTP send (either via the UI form or via
 * `request.post('/auth/otp/send')`). It retries briefly because the log line
 * appears asynchronously after the server processes the request.
 */
export async function readOtpFromLogs(phone: string): Promise<string> {
  const { exec } = await import('node:child_process')
  const { promisify } = await import('node:util')
  const pExec = promisify(exec)
  const cmd = `docker logs --tail 300 dashgo-api 2>&1 | grep -F "${phone}" | grep -oE "código DashGo es [0-9]+" | tail -1 | grep -oE "[0-9]+"`

  // Retry for up to 3s. The log line lands within ~50ms in practice.
  const deadline = Date.now() + 3_000
  let code = ''
  while (Date.now() < deadline) {
    const { stdout } = await pExec(cmd, { shell: '/bin/bash' })
    code = stdout.trim()
    if (/^\d{6}$/.test(code)) return code
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
  throw new Error(`Failed to read OTP for ${phone} within 3s. Last output: "${code}"`)
}

/**
 * Trigger an OTP send via the API and read the resulting code from logs.
 *
 * Use for API-only flows. For UI tests, click the form button instead of
 * calling this helper so the OTP isn't double-sent (the per-phone throttle
 * has a 30s cooldown that will block the second send).
 */
export async function requestAndReadOtp(
  request: APIRequestContext,
  phone: string,
): Promise<string> {
  const send = await request.post(`${API_URL}/auth/otp/send`, {
    data: { phone },
  })
  if (send.status() !== 200) {
    const body = await send.text()
    throw new Error(
      `OTP send for ${phone} returned ${send.status()}: ${body.slice(0, 200)}`,
    )
  }
  const body = await send.json()
  expect(body.sent).toBe(true)
  return readOtpFromLogs(phone)
}

export type Session = { accessToken: string; refreshToken: string }

/**
 * Cache OTP-derived sessions across tests in the same run. The OTP send has a
 * 30s per-phone cooldown — without caching, repeated `loginAs(samePhone)`
 * calls flake out. Tokens are valid for ~1h, plenty for a full E2E run.
 *
 * Tests that need to drive the login UI itself MUST NOT use this — go through
 * the form click path with a different seeded phone.
 */
const sessionCache = new Map<string, Session>()

/**
 * Full auth: OTP send + verify + return both tokens. Cached per-phone for the
 * lifetime of the test run.
 */
export async function loginAs(
  request: APIRequestContext,
  phone: string,
): Promise<Session> {
  const cached = sessionCache.get(phone)
  if (cached) return cached

  const code = await requestAndReadOtp(request, phone)
  const verify = await request.post(`${API_URL}/auth/otp/verify`, {
    data: { phone, code },
  })
  expect(verify.status(), `OTP verify for ${phone}`).toBe(200)
  const body = await verify.json()
  expect(body.accessToken, 'accessToken').toBeTruthy()
  expect(body.refreshToken, 'refreshToken').toBeTruthy()
  const session = { accessToken: body.accessToken, refreshToken: body.refreshToken }
  sessionCache.set(phone, session)
  return session
}

/**
 * Seed both tokens into the browser localStorage so the React app boots into
 * an authenticated session. Keys mirror src/lib/api.ts (TOKEN_KEY,
 * REFRESH_KEY). Call BEFORE `page.goto('/')`.
 */
export async function setSession(
  context: import('@playwright/test').BrowserContext,
  session: Session,
): Promise<void> {
  await context.addInitScript((s) => {
    window.localStorage.setItem('dashgo.accessToken', s.accessToken)
    window.localStorage.setItem('dashgo.refreshToken', s.refreshToken)
  }, session)
}
