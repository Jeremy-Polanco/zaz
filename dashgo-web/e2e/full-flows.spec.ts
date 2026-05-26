import { expect, test } from '@playwright/test'
import { API_URL, SEEDED, loginAs } from './helpers'

/**
 * Full-flow API regression suite.
 *
 * Exercises every role's primary surface against the live api so that bugs
 * found in the manual /verify pass don't regress. Each describe block maps
 * 1:1 to a role; cross-role flows live at the bottom.
 *
 * These tests are API-only (no browser) so they're fast and stable. UI
 * coverage for the same flows lives in brand/auth/rental-cycle specs.
 */

test.describe('Super admin — core resource flows', () => {
  test('categories CRUD + brand + display order', async ({ request }) => {
    const admin = await loginAs(request, SEEDED.superAdmin)
    const auth = { Authorization: `Bearer ${admin.accessToken}` }

    const list = await (await request.get(`${API_URL}/categories`)).json()
    expect(Array.isArray(list)).toBe(true)
    expect(list.length).toBeGreaterThanOrEqual(4) // Agua, Bebidas, Hielo, Accesorios

    const created = await (
      await request.post(`${API_URL}/categories`, {
        headers: { ...auth, 'Content-Type': 'application/json' },
        data: {
          name: `QA Cat ${Date.now()}`,
          slug: `qa-cat-${Date.now()}`,
          iconEmoji: '🧪',
          displayOrder: 99,
        },
      })
    ).json()
    expect(created.id).toBeTruthy()

    const patched = await request.patch(`${API_URL}/categories/${created.id}`, {
      headers: { ...auth, 'Content-Type': 'application/json' },
      data: { iconEmoji: '⚗️' },
    })
    expect(patched.status()).toBe(200)

    const deleted = await request.delete(`${API_URL}/categories/${created.id}`, {
      headers: auth,
    })
    expect(deleted.status()).toBe(200)
  })

  test('FIX-2: admin credit-accounts list returns 200 with items (was 500 — TypeORM snake_case orderBy)', async ({
    request,
  }) => {
    const admin = await loginAs(request, SEEDED.superAdmin)
    const auth = { Authorization: `Bearer ${admin.accessToken}` }
    const res = await request.get(`${API_URL}/admin/credit-accounts`, { headers: auth })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({
      items: expect.any(Array),
      page: expect.any(Number),
      pageSize: expect.any(Number),
      totalCount: expect.any(Number),
      totalPages: expect.any(Number),
    })
  })

  test('admin can grant credit to a customer', async ({ request }) => {
    const admin = await loginAs(request, SEEDED.superAdmin)
    const auth = { Authorization: `Bearer ${admin.accessToken}` }
    const aldia = await loginAs(request, SEEDED.clientAlDia)
    const aldiaUser = await (
      await request.get(`${API_URL}/auth/me`, {
        headers: { Authorization: `Bearer ${aldia.accessToken}` },
      })
    ).json()
    const res = await request.post(
      `${API_URL}/admin/credit-accounts/${aldiaUser.id}/grant`,
      {
        headers: { ...auth, 'Content-Type': 'application/json' },
        data: { amountCents: 500, note: 'E2E grant' },
      },
    )
    expect(res.status()).toBe(201)
    const movement = await res.json()
    expect(movement.type).toBe('grant')
    expect(movement.amountCents).toBe(500)
  })
})

test.describe('Super admin — orders queue + transitions', () => {
  test('full order lifecycle: place → quote → confirm-cash → confirmed → in_route → delivered → invoice', async ({
    request,
  }) => {
    const admin = await loginAs(request, SEEDED.superAdmin)
    const client = await loginAs(request, SEEDED.client)
    const adminAuth = { Authorization: `Bearer ${admin.accessToken}` }
    const clientAuth = { Authorization: `Bearer ${client.accessToken}` }

    const products = await (
      await request.get(`${API_URL}/products`, { headers: clientAuth })
    ).json()
    const sp = (products as Array<{ id: string; pricingMode: string }>).find(
      (p) => p.pricingMode === 'single_payment',
    )!
    expect(sp).toBeTruthy()

    const placed = await request.post(`${API_URL}/orders`, {
      headers: { ...clientAuth, 'Content-Type': 'application/json' },
      data: {
        items: [{ productId: sp.id, quantity: 2 }],
        paymentMethod: 'cash',
        deliveryAddress: { text: 'E2E Lifecycle 1', lat: 40.7, lng: -74.0 },
      },
    })
    expect(placed.status()).toBe(201)
    const order = await placed.json()
    expect(order.status).toBe('pending_quote')

    // Admin quotes shipping (SetQuoteDto: only shippingCents)
    const quoted = await request.patch(`${API_URL}/orders/${order.id}/quote`, {
      headers: { ...adminAuth, 'Content-Type': 'application/json' },
      data: { shippingCents: 300 },
    })
    expect(quoted.status()).toBe(200)
    const afterQuote = await quoted.json()
    expect(afterQuote.status).toBe('quoted')
    expect(afterQuote.shipping).toBe('3.00')

    // Client confirms cash
    const confirmed = await request.post(
      `${API_URL}/orders/${order.id}/confirm-cash`,
      { headers: { ...clientAuth, 'Content-Type': 'application/json' }, data: {} },
    )
    expect(confirmed.status()).toBe(201)
    const afterConfirm = await (
      await request.get(`${API_URL}/orders/${order.id}`, { headers: adminAuth })
    ).json()
    expect(afterConfirm.status).toBe('pending_validation')

    // Admin transitions through to delivered
    for (const s of ['confirmed_by_colmado', 'in_delivery_route', 'delivered']) {
      const r = await request.patch(`${API_URL}/orders/${order.id}/status`, {
        headers: { ...adminAuth, 'Content-Type': 'application/json' },
        data: { status: s },
      })
      expect(r.status(), `transition to ${s}`).toBe(200)
    }

    // Invoice now available
    const invoice = await request.get(`${API_URL}/orders/${order.id}/invoice`, {
      headers: clientAuth,
    })
    expect(invoice.status()).toBe(200)
    const inv = await invoice.json()
    expect(inv.items.length).toBe(1)
    expect(inv.items[0].quantity).toBe(2)
  })
})

test.describe('Super admin — rentals admin', () => {
  test('FIX-3: admin rental DTO includes orderId, pastDueSince, lastLateFeeAt', async ({
    request,
  }) => {
    const admin = await loginAs(request, SEEDED.superAdmin)
    const client = await loginAs(request, SEEDED.client)
    const adminAuth = { Authorization: `Bearer ${admin.accessToken}` }
    const clientAuth = { Authorization: `Bearer ${client.accessToken}` }

    // Create a rental product + place order
    const cats = await (await request.get(`${API_URL}/categories`, { headers: adminAuth })).json()
    const rental = await (
      await request.post(`${API_URL}/products`, {
        headers: { ...adminAuth, 'Content-Type': 'application/json' },
        data: {
          name: `Rental QA ${Date.now()}`,
          categoryId: cats[0].id,
          stock: 5,
          priceToPublic: 0,
          pricingMode: 'rental',
          monthlyRentCents: 1500,
          lateFeeCents: 500,
          stripeProductId: 'prod_dtoTest',
          stripePriceId: 'price_dtoTest',
        },
      })
    ).json()

    const order = await (
      await request.post(`${API_URL}/orders`, {
        headers: { ...clientAuth, 'Content-Type': 'application/json' },
        data: {
          items: [{ productId: rental.id, quantity: 1 }],
          paymentMethod: 'cash',
          deliveryAddress: { text: 'Rental QA', lat: 40.7, lng: -74.0 },
        },
      })
    ).json()

    const rentals = await (
      await request.get(`${API_URL}/admin/rentals`, { headers: adminAuth })
    ).json()
    const matching = (rentals.items as Array<Record<string, unknown>>).find(
      (r) => r.orderId === order.id,
    )!
    expect(matching, 'rental in admin list keyed by orderId').toBeTruthy()
    expect(matching.status).toBe('pending_setup')
    // FIX-3: these fields used to be missing from the DTO entirely.
    expect(matching).toHaveProperty('orderId')
    expect(matching).toHaveProperty('pastDueSince')
    expect(matching).toHaveProperty('lastLateFeeAt')
  })
})

test.describe('Client — me-scoped flows', () => {
  test('FIX-1: /auth/me returns fullName, phone, addressDefault, referralCode', async ({
    request,
  }) => {
    const client = await loginAs(request, SEEDED.client)
    const me = await (
      await request.get(`${API_URL}/auth/me`, {
        headers: { Authorization: `Bearer ${client.accessToken}` },
      })
    ).json()
    expect(me.id).toBeTruthy()
    expect(me.fullName).toBe('Cliente Demo')
    expect(me.phone).toBe(SEEDED.client)
    expect(me.role).toBe('client')
    expect(me.addressDefault).toBeTruthy()
    expect(me.referredById).toBeTruthy() // referred by promoter
    expect(me).toHaveProperty('referralCode')
    expect(me).toHaveProperty('stripeCustomerId')
    expect(me).toHaveProperty('createdAt')
  })

  test('addresses CRUD: create with line1 (not text), set-default', async ({ request }) => {
    const client = await loginAs(request, SEEDED.client)
    const auth = { Authorization: `Bearer ${client.accessToken}`, 'Content-Type': 'application/json' }

    const created = await request.post(`${API_URL}/me/addresses`, {
      headers: auth,
      data: {
        label: 'QA E2E',
        line1: '123 Test St, NY 10001',
        lat: 40.75,
        lng: -73.99,
        instructions: 'Doorbell 4B',
      },
    })
    expect(created.status()).toBe(201)
    const addr = await created.json()
    expect(addr.id).toBeTruthy()
    expect(addr.label).toBe('QA E2E')

    const setDefault = await request.patch(
      `${API_URL}/me/addresses/${addr.id}/set-default`,
      { headers: auth },
    )
    expect(setDefault.status()).toBe(200)

    const cleanup = await request.delete(`${API_URL}/me/addresses/${addr.id}`, {
      headers: auth,
    })
    // DELETE returns 204 No Content on success (REST convention).
    expect([200, 204]).toContain(cleanup.status())
  })

  test('FIX-4: /me/subscription returns JSON null body (not empty) when no subscription', async ({
    request,
  }) => {
    const client = await loginAs(request, SEEDED.client)
    const res = await request.get(`${API_URL}/me/subscription`, {
      headers: { Authorization: `Bearer ${client.accessToken}` },
    })
    expect(res.status()).toBe(200)
    expect(res.headers()['content-type']).toContain('application/json')
    const text = await res.text()
    expect(text.trim()).toBe('null') // literal JSON null, not empty
    expect(JSON.parse(text)).toBeNull() // parses cleanly
  })

  test('/me/credit returns flat shape', async ({ request }) => {
    const client = await loginAs(request, SEEDED.client)
    const credit = await (
      await request.get(`${API_URL}/me/credit`, {
        headers: { Authorization: `Bearer ${client.accessToken}` },
      })
    ).json()
    expect(credit).toMatchObject({
      balanceCents: expect.any(Number),
      creditLimitCents: expect.any(Number),
      status: expect.any(String),
      amountOwedCents: expect.any(Number),
      locked: expect.any(Boolean),
      movements: expect.any(Array),
    })
  })

  test('/points/balance returns claimable/pending/redeemed/expired', async ({ request }) => {
    const client = await loginAs(request, SEEDED.client)
    const points = await (
      await request.get(`${API_URL}/points/balance`, {
        headers: { Authorization: `Bearer ${client.accessToken}` },
      })
    ).json()
    expect(points).toMatchObject({
      claimableCents: expect.any(Number),
      pendingCents: expect.any(Number),
      redeemedCents: expect.any(Number),
      expiredCents: expect.any(Number),
    })
    expect(points.claimableCents).toBe(250) // seeded
  })
})

test.describe('Promoter — dashboard + commissions', () => {
  test('/promoters/me + dashboard + commissions + by-code public', async ({ request }) => {
    const promoter = await loginAs(request, SEEDED.promoter)
    const auth = { Authorization: `Bearer ${promoter.accessToken}` }

    const me = await (await request.get(`${API_URL}/promoters/me`, { headers: auth })).json()
    expect(me.referralCode).toBe('DEMO123A')
    expect(me.referredCount).toBeGreaterThanOrEqual(1)
    expect(me.shareUrl).toContain('/r/DEMO123A')

    const dashboard = await (
      await request.get(`${API_URL}/promoters/me/dashboard`, { headers: auth })
    ).json()
    expect(dashboard.balances).toMatchObject({
      pendingCents: expect.any(Number),
      claimableCents: expect.any(Number),
      paidCents: expect.any(Number),
    })

    const commissions = await (
      await request.get(`${API_URL}/promoters/me/commissions`, { headers: auth })
    ).json()
    // Paginated response: { items, page, pageSize, totalCount, totalPages }
    expect(commissions).toMatchObject({
      items: expect.any(Array),
      totalCount: expect.any(Number),
    })

    // by-code is public — should work without auth
    const publicLookup = await request.get(`${API_URL}/promoters/by-code/DEMO123A`)
    expect(publicLookup.status()).toBe(200)
    const publicData = await publicLookup.json()
    expect(publicData.fullName).toBe('Promoter Demo')
  })
})

test.describe('Cross-role — guards and edge cases', () => {
  test('overdue customer (CLIENT_VENC) gets 402 CREDIT_OVERDUE on order placement', async ({
    request,
  }) => {
    const venc = await loginAs(request, SEEDED.clientVenc)
    const auth = { Authorization: `Bearer ${venc.accessToken}` }

    const products = await (await request.get(`${API_URL}/products`, { headers: auth })).json()
    const sp = (products as Array<{ id: string; pricingMode: string }>).find(
      (p) => p.pricingMode === 'single_payment',
    )!

    const res = await request.post(`${API_URL}/orders`, {
      headers: { ...auth, 'Content-Type': 'application/json' },
      data: {
        items: [{ productId: sp.id, quantity: 1 }],
        paymentMethod: 'cash',
        deliveryAddress: { text: 'Overdue test', lat: 40.7, lng: -74.0 },
      },
    })
    expect(res.status()).toBe(402)
    const body = await res.json()
    expect(body.code).toBe('CREDIT_OVERDUE')
  })

  test('unauthenticated requests are rejected (401) except public categories', async ({
    request,
  }) => {
    expect((await request.get(`${API_URL}/auth/me`)).status()).toBe(401)
    expect((await request.get(`${API_URL}/admin/rentals`)).status()).toBe(401)
    expect((await request.get(`${API_URL}/orders`)).status()).toBe(401)
    expect((await request.get(`${API_URL}/products`)).status()).toBe(401)
    expect((await request.get(`${API_URL}/categories`)).status()).toBe(200) // public
  })

  test('client cannot access admin endpoints (403)', async ({ request }) => {
    const client = await loginAs(request, SEEDED.client)
    const auth = { Authorization: `Bearer ${client.accessToken}` }
    expect((await request.get(`${API_URL}/admin/rentals`, { headers: auth })).status()).toBe(403)
    expect((await request.get(`${API_URL}/promoters`, { headers: auth })).status()).toBe(403)
  })
})
