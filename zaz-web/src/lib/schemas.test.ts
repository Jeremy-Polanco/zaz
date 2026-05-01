import { describe, it, expect } from 'vitest'
import {
  phoneSchema,
  sendOtpSchema,
  verifyOtpSchema,
  checkoutSchema,
  grantCreditSchema,
  subscriptionSchema,
  subscriptionStatusSchema,
} from './schemas'
import { z } from 'zod'

// ── phoneSchema ───────────────────────────────────────────────────────────────

describe('phoneSchema', () => {
  it('accepts a valid E.164 phone number', () => {
    expect(() => phoneSchema.parse('+18091234567')).not.toThrow()
  })

  it('rejects a number without + prefix', () => {
    const result = phoneSchema.safeParse('18091234567')
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0].message).toMatch(/E\.164/)
    }
  })

  it('rejects a number that is too short', () => {
    const result = phoneSchema.safeParse('+123')
    expect(result.success).toBe(false)
  })
})

// ── sendOtpSchema ─────────────────────────────────────────────────────────────

describe('sendOtpSchema', () => {
  it('accepts a valid payload', () => {
    expect(() => sendOtpSchema.parse({ phone: '+18091234567' })).not.toThrow()
  })

  it('rejects a missing phone field', () => {
    const result = sendOtpSchema.safeParse({})
    expect(result.success).toBe(false)
  })
})

// ── verifyOtpSchema ───────────────────────────────────────────────────────────

describe('verifyOtpSchema', () => {
  it('accepts a valid code', () => {
    expect(() =>
      verifyOtpSchema.parse({ phone: '+18091234567', code: '123456' }),
    ).not.toThrow()
  })

  it('rejects a code that is not 6 digits', () => {
    const result = verifyOtpSchema.safeParse({ phone: '+18091234567', code: '123' })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0].message).toMatch(/6 dígitos/)
    }
  })

  it('rejects referralCode that is not 8 characters', () => {
    const result = verifyOtpSchema.safeParse({
      phone: '+18091234567',
      code: '123456',
      referralCode: 'SHORT',
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0].message).toMatch(/8 caracteres/)
    }
  })
})

// ── checkoutSchema ────────────────────────────────────────────────────────────

describe('checkoutSchema', () => {
  const validCheckout = {
    deliveryAddress: { text: 'Calle 1 #23', lat: 18.5, lng: -69.9 },
    paymentMethod: 'cash' as const,
    items: [{ productId: '550e8400-e29b-41d4-a716-446655440000', quantity: 2 }],
  }

  it('accepts a valid checkout payload', () => {
    expect(() => checkoutSchema.parse(validCheckout)).not.toThrow()
  })

  it('rejects an empty items array', () => {
    const result = checkoutSchema.safeParse({ ...validCheckout, items: [] })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0].message).toMatch(/producto/)
    }
  })

  it('rejects an invalid paymentMethod', () => {
    const result = checkoutSchema.safeParse({ ...validCheckout, paymentMethod: 'crypto' })
    expect(result.success).toBe(false)
  })

  it('rejects missing lat/lng in deliveryAddress', () => {
    const result = checkoutSchema.safeParse({
      ...validCheckout,
      deliveryAddress: { text: 'Calle sin ubicación' },
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      const msgs = result.error.issues.map((i) => i.message)
      expect(msgs.join(' ')).toMatch(/ubicación/)
    }
  })
})

// ── grantCreditSchema ─────────────────────────────────────────────────────────

describe('grantCreditSchema', () => {
  it('accepts valid input', () => {
    expect(() => grantCreditSchema.parse({ amountCents: 1000 })).not.toThrow()
  })

  it('rejects amountCents of 0', () => {
    const result = grantCreditSchema.safeParse({ amountCents: 0 })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0].message).toMatch(/Monto inválido/)
    }
  })

  it('rejects non-integer amountCents', () => {
    const result = grantCreditSchema.safeParse({ amountCents: 9.99 })
    expect(result.success).toBe(false)
  })
})

// ── subscriptionStatusSchema ──────────────────────────────────────────────────

describe('subscriptionStatusSchema', () => {
  it('accepts all valid statuses', () => {
    const validStatuses = ['active', 'past_due', 'canceled', 'unpaid', 'incomplete', 'incomplete_expired']
    for (const s of validStatuses) {
      expect(() => subscriptionStatusSchema.parse(s)).not.toThrow()
    }
  })

  it('rejects an unknown status', () => {
    const result = subscriptionStatusSchema.safeParse('paused')
    expect(result.success).toBe(false)
  })
})

// ── subscriptionSchema ────────────────────────────────────────────────────────

describe('subscriptionSchema', () => {
  const validSub = {
    id: '550e8400-e29b-41d4-a716-446655440000',
    status: 'active',
    currentPeriodStart: '2026-01-01T00:00:00.000Z',
    currentPeriodEnd: '2026-02-01T00:00:00.000Z',
    cancelAtPeriodEnd: false,
    canceledAt: null,
  }

  it('accepts a valid subscription object', () => {
    expect(() => subscriptionSchema.parse(validSub)).not.toThrow()
  })

  it('rejects a subscription with an invalid status', () => {
    const result = subscriptionSchema.safeParse({ ...validSub, status: 'trialing' })
    expect(result.success).toBe(false)
  })

  it('rejects if id is not a UUID', () => {
    const result = subscriptionSchema.safeParse({ ...validSub, id: 'not-a-uuid' })
    expect(result.success).toBe(false)
  })
})

// ── ZodError shape sanity check ───────────────────────────────────────────────

describe('ZodError shape', () => {
  it('invalid payload throws ZodError with meaningful message', () => {
    let thrown: unknown
    try {
      sendOtpSchema.parse({ phone: 'bad' })
    } catch (e) {
      thrown = e
    }
    expect(thrown).toBeInstanceOf(z.ZodError)
    const err = thrown as z.ZodError
    expect(err.issues.length).toBeGreaterThan(0)
    expect(err.issues[0].message).toBeTruthy()
  })
})
