import { exec } from 'node:child_process'
import { promisify } from 'node:util'

const pExec = promisify(exec)

/**
 * Restart the API container before each Playwright run so we get a clean
 * @nestjs/throttler in-memory state. Without this, back-to-back runs trip
 * the per-phone OTP throttle (3 per 60s) because buckets persist in process
 * memory across test sessions.
 *
 * If E2E_SKIP_RESTART is set (CI with its own teardown), skip.
 */
export default async function globalSetup(): Promise<void> {
  if (process.env.E2E_SKIP_RESTART) {
    console.log('[e2e:global-setup] E2E_SKIP_RESTART set — skipping api restart')
    return
  }

  console.log('[e2e:global-setup] restarting dashgo-api to clear throttler state…')
  try {
    await pExec('docker restart dashgo-api', { timeout: 30_000 })
  } catch (err) {
    console.warn(
      `[e2e:global-setup] docker restart failed — assuming local non-docker run: ${(err as Error).message}`,
    )
    return
  }

  // Poll the health endpoint until the api answers.
  const start = Date.now()
  while (Date.now() - start < 60_000) {
    try {
      const apiUrl = process.env.E2E_API_URL ?? 'http://localhost:3002/api'
      const res = await fetch(`${apiUrl}/health`)
      if (res.ok) {
        const body = await res.json()
        if (body.status === 'ok' && body.db === 'up') {
          console.log(
            `[e2e:global-setup] api healthy after ${Math.round((Date.now() - start) / 1000)}s`,
          )
          return
        }
      }
    } catch {
      /* swallow — still booting */
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000))
  }
  throw new Error('api did not return healthy within 60s after restart')
}
