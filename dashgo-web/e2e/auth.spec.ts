import { expect, test } from '@playwright/test'
import { SEEDED, readOtpFromLogs } from './helpers'

/**
 * UI-driven OTP login flow.
 *
 * These tests intentionally use *different* seeded phone numbers than the
 * rental-cycle suite so the 30s per-phone OTP cooldown doesn't cross-test.
 */
test.describe('OTP login flow', () => {
  test('user can log in through the UI form', async ({ page }) => {
    await page.goto('/login')

    await expect(page.getByRole('heading', { name: /Iniciar sesión/i })).toBeVisible()
    await page.locator('#phone').fill(SEEDED.clientAlDia)
    await page.getByRole('button', { name: /Enviar código/ }).click()

    // Step 2 — code only renders after the OTP send succeeds.
    await expect(page.locator('#code')).toBeVisible({ timeout: 10_000 })

    const code = await readOtpFromLogs(SEEDED.clientAlDia)
    await page.locator('#code').fill(code)
    await page.getByRole('button', { name: /Verificar/ }).click()

    // Success: any route other than /login. We don't assert the destination
    // role-by-role here; that's covered by route-guard tests elsewhere.
    await page.waitForURL(/^(?!.*\/login).*/, { timeout: 15_000 })
  })

  test('invalid OTP code shows an error', async ({ page }) => {
    await page.goto('/login')
    // Different phone again to avoid the cooldown from the previous test.
    await page.locator('#phone').fill(SEEDED.promoter)
    await page.getByRole('button', { name: /Enviar código/ }).click()

    await expect(page.locator('#code')).toBeVisible({ timeout: 10_000 })
    await page.locator('#code').fill('000000') // wrong code
    await page.getByRole('button', { name: /Verificar/ }).click()

    await expect(page.getByText(/Código inválido|incorrecto/i)).toBeVisible({
      timeout: 8_000,
    })
  })
})
