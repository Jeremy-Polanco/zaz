import { expect, test } from '@playwright/test'

test.describe('Brand surface', () => {
  test('login page renders with Udash title + meta + brand colors', async ({ page }) => {
    await page.goto('/login')
    await expect(page).toHaveTitle(/Udash/i)

    const description = await page.locator('meta[name="description"]').getAttribute('content')
    expect(description).toMatch(/Udash/)

    const themeColor = await page.locator('meta[name="theme-color"]').getAttribute('content')
    expect(themeColor).toBe('#16223C')
  })

  test('favicon.svg serves the navy UD monogram with the orange accent', async ({ page }) => {
    const response = await page.request.get('/favicon.svg')
    expect(response.status()).toBe(200)
    expect(response.headers()['content-type']).toContain('image/svg')
    const body = await response.text()
    // Udash navy background.
    expect(body).toContain('#16223C')
    // Orange accent (Udash brand color).
    expect(body).toContain('#FF8000')
    // No legacy ZAZ purple anywhere.
    expect(body).not.toContain('#220247')
    expect(body).not.toContain('#F5E447')
  })

  test('udash-logo.png brand asset is served', async ({ page }) => {
    const response = await page.request.get('/brand/udash-logo.png')
    expect(response.status()).toBe(200)
    expect(response.headers()['content-type']).toContain('image/png')
  })

  test('login poster shows the Udash logo', async ({ page }) => {
    await page.goto('/login')
    await expect(page.getByAltText('Udash logo')).toBeVisible()
  })

  test('no legacy ZAZ / Colmapp branding in rendered HTML head + body text', async ({ page }) => {
    await page.goto('/login')
    // Check user-visible text, not the full DOM (dev-mode vite shims sometimes
    // leak module paths containing legacy names which aren't user-facing).
    const headText = await page.locator('head').textContent()
    const bodyText = await page.locator('body').innerText()
    expect(headText ?? '').not.toMatch(/\bZAZ\b/)
    expect(bodyText).not.toMatch(/\bZAZ\b/)
    expect(bodyText).not.toMatch(/Bodeguita/)
    expect(bodyText).not.toMatch(/Colmapp/i)
  })
})
