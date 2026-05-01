import { z } from 'zod'

export const phoneSchema = z
  .string()
  .regex(/^\+\d{8,15}$/, 'Formato E.164 (ej: +18091234567)')
export const sendOtpSchema = z.object({ phone: phoneSchema })
export type SendOtpInput = z.infer<typeof sendOtpSchema>
export const verifyOtpSchema = z.object({
  phone: phoneSchema,
  code: z.string().regex(/^\d{6}$/, 'Son 6 dígitos'),
  fullName: z
    .string()
    .min(2, 'Tu nombre')
    .or(z.literal(''))
    .optional(),
  referralCode: z
    .string()
    .length(8, 'El código tiene 8 caracteres')
    .or(z.literal(''))
    .optional(),
})
export type VerifyOtpInput = z.infer<typeof verifyOtpSchema>

export const invitePromoterSchema = z.object({
  phone: phoneSchema,
  fullName: z.string().min(2, 'Nombre requerido'),
})
export type InvitePromoterInput = z.infer<typeof invitePromoterSchema>

export const addressSchema = z.object({
  text: z.string().min(5, 'Dirección requerida'),
  lat: z.number().optional(),
  lng: z.number().optional(),
})
export type AddressInput = z.infer<typeof addressSchema>

export const checkoutAddressSchema = z.object({
  text: z.string().min(5, 'Dirección requerida'),
  lat: z.number({ message: 'Necesitamos tu ubicación para calcular el envío' }),
  lng: z.number({ message: 'Necesitamos tu ubicación para calcular el envío' }),
})
export type CheckoutAddressInput = z.infer<typeof checkoutAddressSchema>

export const checkoutSchema = z.object({
  deliveryAddress: checkoutAddressSchema,
  paymentMethod: z.enum(['cash', 'digital']),
  items: z
    .array(
      z.object({
        productId: z.string().uuid(),
        quantity: z.number().int().positive(),
      }),
    )
    .min(1, 'Agrega al menos un producto'),
  usePoints: z.boolean().optional(),
  useCredit: z.boolean().optional(),
})
export type CheckoutInput = z.infer<typeof checkoutSchema>

// ── Credit schemas (Zod 4) ────────────────────────────────────────────────────

export const grantCreditSchema = z.object({
  amountCents: z.number().int().min(1, 'Monto inválido'),
  note: z.string().optional(),
  dueDate: z.string().optional(),
})
export type GrantCreditInput = z.infer<typeof grantCreditSchema>

export const recordPaymentSchema = z.object({
  amountCents: z.number().int().min(1, 'Monto inválido'),
  note: z.string().optional(),
})
export type RecordPaymentInput = z.infer<typeof recordPaymentSchema>

export const adjustCreditSchema = z.object({
  newLimitCents: z.number().int().min(0).optional(),
  dueDate: z.string().nullable().optional(),
  note: z.string().optional(),
})
export type AdjustCreditInput = z.infer<typeof adjustCreditSchema>

export const listAccountsQuerySchema = z.object({
  status: z.enum(['al-dia', 'vencido', 'sin-deuda']).optional(),
  search: z.string().optional(),
  page: z.number().optional(),
  pageSize: z.number().optional(),
})
export type ListAccountsQueryInput = z.infer<typeof listAccountsQuerySchema>

export const manualAdjustmentSchema = z.object({
  amountCents: z.number().int(),
  note: z.string().min(1, 'La nota es requerida'),
})
export type ManualAdjustmentInput = z.infer<typeof manualAdjustmentSchema>

// ── Subscription schemas (Zod 4) ──────────────────────────────────────────────

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
