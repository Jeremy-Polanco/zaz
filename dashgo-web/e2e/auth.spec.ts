import { expect, test } from '@playwright/test'
import { SEEDED } from './helpers'

/**
 * UI-driven phone-only login flow (no OTP).
 *
 * Phone-only is the default (AUTH_OTP_MODE=disabled). The user enters a phone
 * and is logged straight in — there is no code step. Each test uses a distinct
 * seeded phone to stay independent.
 */
test.describe('phone-only login flow', () => {
  test('an existing user logs in with just their phone', async ({ page }) => {
    await page.goto('/login')

    await expect(
      page.getByRole('heading', { name: /Iniciar sesión/i }),
    ).toBeVisible()

    // No OTP code field exists in the default flow.
    await expect(page.locator('#code')).toHaveCount(0)

    await page.locator('#phone').fill(SEEDED.clientAlDia)
    await page.getByRole('button', { name: /Entrar/i }).click()

    // Success: any route other than /login (no intermediate code screen).
    await page.waitForURL(/^(?!.*\/login).*/, { timeout: 15_000 })
  })

  test('a malformed phone is rejected client-side', async ({ page }) => {
    await page.goto('/login')

    await page.locator('#phone').fill('12345') // not E.164
    await page.getByRole('button', { name: /Entrar/i }).click()

    // Stays on /login and surfaces the format hint; never advances.
    await expect(page.getByText(/E\.164/i)).toBeVisible({ timeout: 8_000 })
    await expect(page).toHaveURL(/\/login/)
  })
})
