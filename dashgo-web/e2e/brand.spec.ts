import { expect, test } from '@playwright/test'

test.describe('Brand surface', () => {
  test('login page renders with DashGo title + meta + brand colors', async ({ page }) => {
    await page.goto('/login')
    await expect(page).toHaveTitle(/DashGo/i)

    const description = await page.locator('meta[name="description"]').getAttribute('content')
    expect(description).toMatch(/DashGo/)

    const themeColor = await page.locator('meta[name="theme-color"]').getAttribute('content')
    expect(themeColor).toBe('#000000')
  })

  test('favicon.svg serves a black square with the orange bolt', async ({ page }) => {
    const response = await page.request.get('/favicon.svg')
    expect(response.status()).toBe(200)
    expect(response.headers()['content-type']).toContain('image/svg')
    const body = await response.text()
    // Black background.
    expect(body).toContain('fill="#000000"')
    // Orange bolt path (DashGo accent color).
    expect(body).toContain('#FF8000')
    // No legacy ZAZ purple anywhere.
    expect(body).not.toContain('#220247')
    expect(body).not.toContain('#F5E447')
  })

  test('dashgo-logo.svg includes the Dash⚡Go wordmark with DELIVERY · NEW YORK eyebrow', async ({
    page,
  }) => {
    const response = await page.request.get('/dashgo-logo.svg')
    expect(response.status()).toBe(200)
    const body = await response.text()
    expect(body).toContain('Dash')
    expect(body).toContain('Go')
    expect(body).toContain('DELIVERY · NEW YORK')
    expect(body).toContain('#FF8000') // bolt orange
  })

  test('no legacy ZAZ branding in rendered HTML head + body text', async ({ page }) => {
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
