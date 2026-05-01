/**
 * Mobile schemas tests — uses Zod v3 (NOT v4).
 * Zod v3 API: .parse() throws ZodError, .safeParse() returns { success, error }.
 */
import {
  addressSchema,
  checkoutAddressSchema,
  checkoutSchema,
  phoneSchema,
  sendOtpSchema,
  verifyOtpSchema,
  grantCreditSchema,
  recordPaymentSchema,
  adjustCreditSchema,
  manualAdjustmentSchema,
  subscriptionStatusSchema,
  subscriptionSchema,
  subscriptionPlanSchema,
} from './schemas'

describe('addressSchema', () => {
  it('accepts a valid address with text only', () => {
    const result = addressSchema.safeParse({ text: 'Calle 123' })
    expect(result.success).toBe(true)
  })

  it('rejects an address with text shorter than 3 chars', () => {
    const result = addressSchema.safeParse({ text: 'AB' })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0].message).toBe('Dirección muy corta')
    }
  })

  it('accepts optional lat/lng', () => {
    const result = addressSchema.safeParse({ text: 'Calle 123', lat: 18.5, lng: -69.9 })
    expect(result.success).toBe(true)
  })
})

describe('checkoutAddressSchema', () => {
  it('requires lat', () => {
    const result = checkoutAddressSchema.safeParse({ text: 'Calle 123', lng: -69.9 })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0].message).toBe(
        'Necesitamos tu ubicación para calcular el envío',
      )
    }
  })

  it('requires lng', () => {
    const result = checkoutAddressSchema.safeParse({ text: 'Calle 123', lat: 18.5 })
    expect(result.success).toBe(false)
  })

  it('accepts a complete address', () => {
    const result = checkoutAddressSchema.safeParse({
      text: 'Calle 123',
      lat: 18.5,
      lng: -69.9,
    })
    expect(result.success).toBe(true)
  })
})

describe('checkoutSchema', () => {
  const validCheckout = {
    items: [{ productId: '550e8400-e29b-41d4-a716-446655440000', quantity: 2 }],
    deliveryAddress: { text: 'Calle 123', lat: 18.5, lng: -69.9 },
    paymentMethod: 'digital' as const,
  }

  it('accepts a valid checkout payload', () => {
    const result = checkoutSchema.safeParse(validCheckout)
    expect(result.success).toBe(true)
  })

  it('rejects an empty items array', () => {
    const result = checkoutSchema.safeParse({ ...validCheckout, items: [] })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0].message).toBe('El carrito está vacío')
    }
  })

  it('rejects a non-UUID productId', () => {
    const result = checkoutSchema.safeParse({
      ...validCheckout,
      items: [{ productId: 'not-a-uuid', quantity: 1 }],
    })
    expect(result.success).toBe(false)
  })

  it('rejects an invalid paymentMethod', () => {
    const result = checkoutSchema.safeParse({ ...validCheckout, paymentMethod: 'bitcoin' })
    expect(result.success).toBe(false)
  })
})

describe('phoneSchema', () => {
  it('accepts a valid E.164 phone', () => {
    const result = phoneSchema.safeParse('+18091234567')
    expect(result.success).toBe(true)
  })

  it('rejects a phone without + prefix', () => {
    const result = phoneSchema.safeParse('18091234567')
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0].message).toBe('Formato E.164 (ej: +18091234567)')
    }
  })

  it('rejects a phone that is too short', () => {
    const result = phoneSchema.safeParse('+123')
    expect(result.success).toBe(false)
  })
})

describe('sendOtpSchema', () => {
  it('accepts a valid phone', () => {
    expect(sendOtpSchema.safeParse({ phone: '+18091234567' }).success).toBe(true)
  })

  it('rejects a missing phone', () => {
    expect(sendOtpSchema.safeParse({}).success).toBe(false)
  })
})

describe('verifyOtpSchema', () => {
  it('accepts a valid payload', () => {
    const result = verifyOtpSchema.safeParse({
      phone: '+18091234567',
      code: '123456',
    })
    expect(result.success).toBe(true)
  })

  it('rejects a code with wrong length', () => {
    const result = verifyOtpSchema.safeParse({ phone: '+18091234567', code: '12345' })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0].message).toBe('Son 6 dígitos')
    }
  })
})

describe('grantCreditSchema', () => {
  it('accepts valid amountCents ≥ 1', () => {
    expect(grantCreditSchema.safeParse({ amountCents: 100 }).success).toBe(true)
  })

  it('rejects amountCents = 0', () => {
    const result = grantCreditSchema.safeParse({ amountCents: 0 })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0].message).toBe('Debe ser al menos 1 centavo')
    }
  })
})

describe('recordPaymentSchema', () => {
  it('accepts valid amountCents', () => {
    expect(recordPaymentSchema.safeParse({ amountCents: 500 }).success).toBe(true)
  })

  it('rejects zero amount', () => {
    expect(recordPaymentSchema.safeParse({ amountCents: 0 }).success).toBe(false)
  })
})

describe('adjustCreditSchema', () => {
  it('accepts all fields as optional', () => {
    expect(adjustCreditSchema.safeParse({}).success).toBe(true)
  })

  it('accepts newLimitCents = 0', () => {
    expect(adjustCreditSchema.safeParse({ newLimitCents: 0 }).success).toBe(true)
  })

  it('rejects negative newLimitCents', () => {
    expect(adjustCreditSchema.safeParse({ newLimitCents: -1 }).success).toBe(false)
  })
})

describe('manualAdjustmentSchema', () => {
  it('accepts valid payload', () => {
    expect(
      manualAdjustmentSchema.safeParse({ amountCents: 100, note: 'Adjustment' }).success,
    ).toBe(true)
  })

  it('rejects empty note', () => {
    const result = manualAdjustmentSchema.safeParse({ amountCents: 100, note: '' })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0].message).toBe('La nota es requerida')
    }
  })
})

describe('subscriptionStatusSchema', () => {
  it('accepts all valid statuses', () => {
    const statuses = ['active', 'past_due', 'canceled', 'unpaid', 'incomplete', 'incomplete_expired']
    for (const s of statuses) {
      expect(subscriptionStatusSchema.safeParse(s).success).toBe(true)
    }
  })

  it('rejects an unknown status', () => {
    expect(subscriptionStatusSchema.safeParse('unknown').success).toBe(false)
  })
})

describe('subscriptionSchema', () => {
  it('accepts a valid subscription object', () => {
    const result = subscriptionSchema.safeParse({
      id: '550e8400-e29b-41d4-a716-446655440000',
      status: 'active',
      currentPeriodStart: '2024-01-01',
      currentPeriodEnd: '2024-02-01',
      cancelAtPeriodEnd: false,
      canceledAt: null,
    })
    expect(result.success).toBe(true)
  })
})

describe('subscriptionPlanSchema', () => {
  it('accepts a valid plan', () => {
    const result = subscriptionPlanSchema.safeParse({
      priceCents: 1000,
      currency: 'usd',
      interval: 'month',
    })
    expect(result.success).toBe(true)
  })

  it('rejects non-usd currency', () => {
    const result = subscriptionPlanSchema.safeParse({
      priceCents: 1000,
      currency: 'eur',
      interval: 'month',
    })
    expect(result.success).toBe(false)
  })
})
