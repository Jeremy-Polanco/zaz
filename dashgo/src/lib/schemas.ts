import { z } from 'zod'

export const addressSchema = z.object({
  text: z.string().min(3, 'Dirección muy corta'),
  lat: z.number().optional(),
  lng: z.number().optional(),
})

// Delivery address attached to an order. Built from one of the customer's saved
// addresses (UserAddress) when they pick one at checkout — never free-typed.
// Mirrors the backend DeliveryAddressDto: text/lat/lng required, rest optional.
export const deliveryAddressSchema = z.object({
  text: z.string(),
  lat: z.number(),
  lng: z.number(),
  building: z.string().optional(),
  houseNumber: z.string().optional(),
  unit: z.string().optional(),
  reference: z.string().optional(),
})
export type DeliveryAddressInput = z.infer<typeof deliveryAddressSchema>

export const checkoutSchema = z.object({
  items: z
    .array(
      z.object({
        productId: z.string().uuid(),
        quantity: z.number().int().positive(),
      }),
    )
    .min(1, 'El carrito está vacío'),
  paymentMethod: z.enum(['cash', 'digital']),
  stripePaymentIntentId: z.string().optional(),
  usePoints: z.boolean().optional(),
  useCredit: z.boolean().optional(),
  // Propina — solo pago digital; el server calcula el monto sobre SU subtotal.
  tipPercent: z
    .union([z.literal(15), z.literal(18), z.literal(25)])
    .optional(),
  // Optional: when the customer has saved addresses they pick which one this
  // order goes to. Absent → colmado pins the location at delivery time (legacy).
  deliveryAddress: deliveryAddressSchema.optional(),
})

export const phoneSchema = z
  .string()
  // US/NANP-only: the UI feeds exactly 10 national digits and prepends +1.
  .regex(/^\+1\d{10}$/, 'Son 10 dígitos')
export const sendOtpSchema = z.object({ phone: phoneSchema })

// Optional birthday captured at signup as DD/MM/AAAA in the UI; transformed
// to ISO (YYYY-MM-DD) before hitting the API. Empty string = not provided.
export const dobSchema = z
  .string()
  .regex(/^\d{2}\/\d{2}\/\d{4}$/, 'Formato DD/MM/AAAA')
  .refine((v) => {
    const [d, m, y] = v.split('/').map(Number)
    const date = new Date(y, m - 1, d)
    return (
      date.getFullYear() === y &&
      date.getMonth() === m - 1 &&
      date.getDate() === d &&
      y >= 1900 &&
      date.getTime() < Date.now()
    )
  }, 'Fecha inválida')
  .optional()
  .or(z.literal(''))

export function dobToIso(v: string | undefined): string | undefined {
  if (!v) return undefined
  const [d, m, y] = v.split('/')
  return `${y}-${m}-${d}`
}

// Phone-only login is the default — no code is collected. A name is requested
// only on first login (revealed in-place), mirroring the web flow.
export const loginSchema = z.object({
  phone: phoneSchema,
  fullName: z.string().min(2, 'Tu nombre').optional(),
  referralCode: z.string().length(8, 'El código tiene 8 caracteres').optional(),
  dateOfBirth: dobSchema,
})

export const verifyOtpSchema = z.object({
  phone: phoneSchema,
  code: z.string().regex(/^\d{6}$/, 'Son 6 dígitos'),
  fullName: z.string().min(2, 'Tu nombre').optional(),
  referralCode: z.string().length(8, 'El código tiene 8 caracteres').optional(),
})

export const invitePromoterSchema = z.object({
  phone: phoneSchema,
  fullName: z.string().min(2, 'Nombre requerido'),
})
export type InvitePromoterInput = z.infer<typeof invitePromoterSchema>

export type CheckoutInput = z.infer<typeof checkoutSchema>
export type SendOtpInput = z.infer<typeof sendOtpSchema>
export type LoginInput = z.infer<typeof loginSchema>
export type VerifyOtpInput = z.infer<typeof verifyOtpSchema>

// ── Credit schemas (Zod 3) ────────────────────────────────────────────────────

export const grantCreditSchema = z.object({
  amountCents: z.number().int().min(1, 'Debe ser al menos 1 centavo'),
  note: z.string().optional(),
  dueDate: z.string().optional(),
})

export const recordPaymentSchema = z.object({
  amountCents: z.number().int().min(1, 'Debe ser al menos 1 centavo'),
  note: z.string().optional(),
})

export const adjustCreditSchema = z.object({
  newLimitCents: z.number().int().min(0).optional(),
  dueDate: z.string().optional().nullable(),
  note: z.string().optional(),
})

export const manualAdjustmentSchema = z.object({
  amountCents: z.number().int(),
  note: z.string().min(1, 'La nota es requerida'),
})

export type GrantCreditInput = z.infer<typeof grantCreditSchema>
export type RecordPaymentInput = z.infer<typeof recordPaymentSchema>
export type AdjustCreditInput = z.infer<typeof adjustCreditSchema>
export type ManualAdjustmentInput = z.infer<typeof manualAdjustmentSchema>

// ── User Address schemas (Zod 3) ──────────────────────────────────────────────

export const savedAddressSchema = z.object({
  label: z.string().min(1, 'Nombre requerido').max(60),
  line1: z.string().min(1, 'Dirección requerida').max(255),
  line2: z.string().max(255).optional(),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  instructions: z.string().max(500).optional(),
})

export const updateSavedAddressSchema = savedAddressSchema.partial()

export type SavedAddressInput = z.infer<typeof savedAddressSchema>

// ── Subscription schemas (Zod 3) ──────────────────────────────────────────────

// ── Product pricing schemas (Zod 3) ──────────────────────────────────────────

export const pricingModeSchema = z.enum(['single_payment', 'rental'])

export const productRentalFieldsSchema = z.object({
  pricingMode: pricingModeSchema.optional(),
  monthlyRentCents: z.number().int().min(0).optional(),
  lateFeeCents: z.number().int().min(0).optional(),
})

export const rentalStatusSchema = z.enum([
  'pending_setup',
  'active',
  'past_due',
  'unpaid',
  'canceled',
])

export const rentalSchema = z.object({
  id: z.string().uuid(),
  productId: z.string().uuid(),
  productName: z.string(),
  productImageUrl: z.string().nullable(),
  monthlyRentCents: z.number().int().min(0),
  status: rentalStatusSchema,
  nextChargeAt: z.string().nullable(),
  activatedAt: z.string().nullable(),
})

// ── Subscription schemas (Zod 3) ──────────────────────────────────────────────

export const subscriptionStatusSchema = z.enum([
  'active',
  'past_due',
  'canceled',
  'unpaid',
  'incomplete',
  'incomplete_expired',
])

export const subscriptionSchema = z.object({
  id: z.string().uuid(),
  status: subscriptionStatusSchema,
  currentPeriodStart: z.string(),
  currentPeriodEnd: z.string(),
  cancelAtPeriodEnd: z.boolean(),
  canceledAt: z.string().nullable(),
})

export const subscriptionPlanSchema = z.object({
  priceCents: z.number().int().positive(),
  currency: z.literal('usd'),
  interval: z.literal('month'),
})
