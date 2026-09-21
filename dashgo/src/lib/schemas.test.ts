/**
 * Mobile schemas tests — uses Zod v3 (NOT v4).
 * Zod v3 API: .parse() throws ZodError, .safeParse() returns { success, error }.
 */
import {
  addressSchema,
  checkoutSchema,
  deliveryAddressSchema,
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
  savedAddressSchema,
  updateSavedAddressSchema,
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

describe('checkoutSchema', () => {
  const validCheckout = {
    items: [{ productId: '550e8400-e29b-41d4-a716-446655440000', quantity: 2 }],
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
      expect(result.error.issues[0].message).toBe('Son 10 dígitos')
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

describe('savedAddressSchema — postalCode (optional, 5 digits when present)', () => {
  const base = { label: 'Casa', line1: 'Calle 123', lat: 18.5, lng: -69.9 }

  it('accepts a valid 5-digit postalCode', () => {
    const result = savedAddressSchema.safeParse({ ...base, postalCode: '10451' })
    expect(result.success).toBe(true)
  })

  it('accepts a missing postalCode — the server fills it in from the geocoded pin', () => {
    const result = savedAddressSchema.safeParse(base)
    expect(result.success).toBe(true)
  })

  it('rejects a postalCode with fewer than 5 digits', () => {
    const result = savedAddressSchema.safeParse({ ...base, postalCode: '1045' })
    expect(result.success).toBe(false)
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path[0] === 'postalCode')
      expect(issue?.message).toBe('Ingresá un ZIP de 5 dígitos')
    }
  })

  it('rejects a postalCode with non-digit characters', () => {
    const result = savedAddressSchema.safeParse({ ...base, postalCode: '1045a' })
    expect(result.success).toBe(false)
  })

  it('rejects a postalCode longer than 5 digits', () => {
    const result = savedAddressSchema.safeParse({ ...base, postalCode: '104512' })
    expect(result.success).toBe(false)
  })
})

describe('savedAddressSchema — houseNumber (optional, max 40)', () => {
  const base = { label: 'Casa', line1: 'Calle 123', lat: 18.5, lng: -69.9 }

  it('accepts a valid houseNumber', () => {
    const result = savedAddressSchema.safeParse({ ...base, houseNumber: '24' })
    expect(result.success).toBe(true)
  })

  it('accepts a missing houseNumber', () => {
    expect(savedAddressSchema.safeParse(base).success).toBe(true)
  })

  it('rejects a houseNumber longer than 40 characters', () => {
    const result = savedAddressSchema.safeParse({ ...base, houseNumber: 'x'.repeat(41) })
    expect(result.success).toBe(false)
  })
})

describe('updateSavedAddressSchema — postalCode optional but validated', () => {
  it('accepts an update with no postalCode at all', () => {
    const result = updateSavedAddressSchema.safeParse({ label: 'Casa Nueva' })
    expect(result.success).toBe(true)
  })

  it('accepts an update with a valid postalCode', () => {
    const result = updateSavedAddressSchema.safeParse({ postalCode: '07201' })
    expect(result.success).toBe(true)
  })

  it('rejects an update with an invalid postalCode', () => {
    const result = updateSavedAddressSchema.safeParse({ postalCode: 'abc' })
    expect(result.success).toBe(false)
  })
})

describe('deliveryAddressSchema — optional postalCode', () => {
  const base = { text: 'Calle 123', lat: 18.5, lng: -69.9 }

  it('accepts a delivery address without postalCode', () => {
    expect(deliveryAddressSchema.safeParse(base).success).toBe(true)
  })

  it('accepts a delivery address with a postalCode', () => {
    const result = deliveryAddressSchema.safeParse({ ...base, postalCode: '10451' })
    expect(result.success).toBe(true)
  })
})

describe('deliveryAddressSchema — houseNumber (nullable, max 40)', () => {
  const base = { text: 'Calle 123', lat: 18.5, lng: -69.9 }

  it('accepts a delivery address with a houseNumber', () => {
    const result = deliveryAddressSchema.safeParse({ ...base, houseNumber: '24' })
    expect(result.success).toBe(true)
  })

  it('accepts a delivery address without houseNumber at all', () => {
    expect(deliveryAddressSchema.safeParse(base).success).toBe(true)
  })

  // userAddressToGeoAddress() emits `houseNumber: null` (not omitted) when
  // the saved address has none — the schema must accept that explicit null.
  it('accepts an explicit null houseNumber', () => {
    const result = deliveryAddressSchema.safeParse({ ...base, houseNumber: null })
    expect(result.success).toBe(true)
  })

  it('rejects a houseNumber longer than 40 characters', () => {
    const result = deliveryAddressSchema.safeParse({ ...base, houseNumber: 'x'.repeat(41) })
    expect(result.success).toBe(false)
  })
})
