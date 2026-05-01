import { z } from 'zod'

export const addressSchema = z.object({
  text: z.string().min(3, 'Dirección muy corta'),
  lat: z.number().optional(),
  lng: z.number().optional(),
})

export const checkoutAddressSchema = z.object({
  text: z.string().min(3, 'Dirección muy corta'),
  lat: z.number({
    required_error: 'Necesitamos tu ubicación para calcular el envío',
    invalid_type_error: 'Necesitamos tu ubicación para calcular el envío',
  }),
  lng: z.number({
    required_error: 'Necesitamos tu ubicación para calcular el envío',
    invalid_type_error: 'Necesitamos tu ubicación para calcular el envío',
  }),
})

export const checkoutSchema = z.object({
  items: z
    .array(
      z.object({
        productId: z.string().uuid(),
        quantity: z.number().int().positive(),
      }),
    )
    .min(1, 'El carrito está vacío'),
  deliveryAddress: checkoutAddressSchema,
  paymentMethod: z.enum(['cash', 'digital']),
  stripePaymentIntentId: z.string().optional(),
  usePoints: z.boolean().optional(),
  useCredit: z.boolean().optional(),
})

export const phoneSchema = z
  .string()
  .regex(/^\+\d{8,15}$/, 'Formato E.164 (ej: +18091234567)')
export const sendOtpSchema = z.object({ phone: phoneSchema })
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
