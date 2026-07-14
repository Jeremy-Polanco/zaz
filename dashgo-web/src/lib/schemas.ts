import { z } from 'zod'

export const phoneSchema = z
  .string()
  // US/NANP-only: the UI feeds exactly 10 national digits and prepends +1.
  .regex(/^\+1\d{10}$/, 'Son 10 dígitos')
export const sendOtpSchema = z.object({ phone: phoneSchema })
export type SendOtpInput = z.infer<typeof sendOtpSchema>

// Phone-only login is the default. No code is collected — the user enters a
// phone (and, only on first login, a name). `code` is intentionally absent.
export const loginSchema = z.object({
  phone: phoneSchema,
  fullName: z.string().min(2, 'Tu nombre').or(z.literal('')).optional(),
  referralCode: z
    .string()
    .length(8, 'El código tiene 8 caracteres')
    .or(z.literal(''))
    .optional(),
  // Optional at signup — birthday greetings/gifts. Native date input → ISO.
  dateOfBirth: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato AAAA-MM-DD')
    .or(z.literal(''))
    .optional(),
})
export type LoginInput = z.infer<typeof loginSchema>

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

// Saved address book (CRUD against /me/addresses). Mirrors the backend
// CreateAddressDto: label/line1 required, line2/instructions optional, and a
// map-picked lat/lng.
export const savedAddressSchema = z.object({
  label: z.string().min(1, 'Nombre requerido').max(60),
  line1: z.string().min(1, 'Dirección requerida').max(255),
  line2: z.string().max(255).or(z.literal('')).optional(),
  lat: z.number({ message: 'Ubicá el pin en el mapa' }).min(-90).max(90),
  lng: z.number({ message: 'Ubicá el pin en el mapa' }).min(-180).max(180),
  instructions: z.string().max(500).or(z.literal('')).optional(),
})
export type SavedAddressInput = z.infer<typeof savedAddressSchema>

// Delivery address attached to an order. Built from one of the customer's saved
// addresses (UserAddress) when they pick one at checkout — never free-typed.
// Mirrors the backend DeliveryAddressDto: text/lat/lng required, the rest optional.
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

// Checkout carries payment + items + perks, plus an OPTIONAL delivery address:
// when the customer has saved addresses they pick which one this order goes to.
// With no saved address the field stays absent and the colmado pins the location
// at delivery time (legacy behavior).
export const checkoutSchema = z.object({
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
  deliveryAddress: deliveryAddressSchema.optional(),
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
