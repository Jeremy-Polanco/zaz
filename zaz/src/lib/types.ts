export type UserRole = 'client' | 'promoter' | 'super_admin_delivery'

export type OrderStatus =
  | 'pending_quote'
  | 'quoted'
  | 'pending_validation'
  | 'confirmed_by_colmado'
  | 'in_delivery_route'
  | 'delivered'
  | 'cancelled'

export type PaymentMethod = 'cash' | 'digital'

export interface GeoAddress {
  text: string
  lat?: number
  lng?: number
}

export interface AuthUser {
  id: string
  email: string | null
  fullName: string
  phone: string | null
  role: UserRole
  addressDefault: GeoAddress | null
  referralCode: string | null
  creditLocked: boolean
}

export interface Promoter {
  id: string
  fullName: string
  phone: string | null
  referralCode: string | null
  referredCount: number
  claimableCents?: number
  pendingCents?: number
  paidCents?: number
  createdAt: string
}

export interface PromoterMyStats {
  id: string
  fullName: string
  phone: string | null
  referralCode: string | null
  referredCount: number
  shareUrl: string
}

export interface PromoterPublicInfo {
  fullName: string
}

export interface Category {
  id: string
  name: string
  slug: string
  iconEmoji: string | null
  displayOrder: number
  imageUrl?: string | null
  createdAt?: string
}

export interface Product {
  id: string
  name: string
  description: string | null
  priceToPublic: string
  isAvailable: boolean
  stock: number
  imageContentType: string | null
  imageUpdatedAt: string | null
  createdAt: string
  promoterCommissionPct: string
  pointsPct: string
  categoryId: string | null
  category?: Category | null
  offerLabel: string | null
  offerDiscountPct: string | null
  offerStartsAt: string | null
  offerEndsAt: string | null
  effectivePriceCents: number
  basePriceCents: number
  offerActive: boolean
}

export interface OrderItem {
  id: string
  orderId: string
  productId: string
  product?: Product
  quantity: number
  priceAtOrder: string
  createdAt: string
}

export interface Order {
  id: string
  customerId: string
  customer?: AuthUser
  status: OrderStatus
  deliveryAddress: GeoAddress
  subtotal: string
  pointsRedeemed: string
  shipping: string
  tax: string
  taxRate: string
  totalAmount: string
  paymentMethod: PaymentMethod
  stripePaymentIntentId: string | null
  paidAt: string | null
  quotedAt?: string | null
  authorizedAt?: string | null
  capturedAt?: string | null
  /** Amount of store credit applied to this order (decimal string, e.g. "12.50"). */
  creditApplied?: string
  /** True when the order was quoted while the customer had an active subscription. */
  wasSubscriberAtQuote?: boolean
  items: OrderItem[]
  createdAt: string
}

export interface AuthorizedIntent {
  paymentIntentId: string
  clientSecret: string
  amount: number
  currency: string
}

export interface ShippingQuote {
  shippingCents: number
  miles: number | null
}

export type PointsEntryType = 'earned' | 'redeemed' | 'expired'
export type PointsEntryStatus = 'pending' | 'claimable' | 'redeemed' | 'expired'

export interface PointsBalance {
  pendingCents: number
  claimableCents: number
  redeemedCents: number
  expiredCents: number
}

export interface PointsEntry {
  id: string
  userId: string
  type: PointsEntryType
  status: PointsEntryStatus
  amountCents: number
  orderId: string | null
  claimableAt: string | null
  expiresAt: string | null
  createdAt: string
}

export interface InvoiceItem {
  id: string
  productId: string
  productName: string
  quantity: number
  priceAtOrder: string
  lineTotal: string
}

export interface InvoiceCustomer {
  id: string
  fullName: string
  phone: string | null
}

export interface InvoiceOrderRef {
  id: string
  status: OrderStatus
  paymentMethod: PaymentMethod
  deliveryAddress: GeoAddress
  createdAt: string
}

export interface Invoice {
  id: string
  invoiceNumber: string
  orderId: string
  subtotal: string
  pointsRedeemed: string
  shipping: string
  tax: string
  taxRate: string
  total: string
  createdAt: string
  customer: InvoiceCustomer
  order: InvoiceOrderRef
  items: InvoiceItem[]
}

export interface LoginResponse {
  accessToken: string
  refreshToken: string
  user: AuthUser
}

export type PromoterCommissionEntryType = 'earned' | 'paid_out'
export type PromoterCommissionEntryStatus = 'pending' | 'claimable' | 'paid'

export interface PromoterCommissionEntry {
  id: string
  type: PromoterCommissionEntryType
  status: PromoterCommissionEntryStatus
  amountCents: number
  orderId: string | null
  referredUserId: string | null
  referredUserName: string | null
  claimableAt: string | null
  payoutId: string | null
  createdAt: string
}

export interface Payout {
  id: string
  amountCents: number
  notes: string | null
  createdAt: string
  createdBy: { id: string; fullName: string } | null
}

export interface PromoterBalances {
  pendingCents: number
  claimableCents: number
  paidCents: number
}

export interface ReferredCustomerSummary {
  id: string
  fullName: string
  firstOrderAt: string | null
  orderCount: number
  totalSpentCents: number
  totalCommissionGeneratedCents: number
}

export interface PromoterDashboard {
  promoter: {
    id: string
    fullName: string
    phone: string | null
    referralCode: string | null
    shareUrl: string
  }
  balances: PromoterBalances
  referredCount: number
  referredCustomers: ReferredCustomerSummary[]
  recentCommissions: PromoterCommissionEntry[]
  payouts: Payout[]
}

export interface PromoterCommissionsPage {
  items: PromoterCommissionEntry[]
  page: number
  pageSize: number
  totalCount: number
  totalPages: number
}

export interface PromoterListItem {
  id: string
  fullName: string
  phone: string | null
  referralCode: string | null
  referredCount: number
  claimableCents: number
  pendingCents: number
  paidCents: number
  createdAt: string
}

// ── Credit ("Fiado") ──────────────────────────────────────────────────────────

export type CreditMovementType =
  | 'grant'
  | 'charge'
  | 'reversal'
  | 'payment'
  | 'adjustment'
  | 'adjustment_increase'
  | 'adjustment_decrease'
export type CreditAccountStatus = 'none' | 'active' | 'overdue'

export interface CreditMovement {
  id: string
  type: CreditMovementType
  amountCents: number
  orderId: string | null
  note: string | null
  createdAt: string
}

export interface MyCreditResponse {
  balanceCents: number | null
  creditLimitCents: number | null
  dueDate: string | null
  status: CreditAccountStatus
  amountOwedCents: number
  locked: boolean
  movements: CreditMovement[]
}

export interface CreditAccountListItem {
  userId: string
  fullName: string
  balanceCents: number
  creditLimitCents: number
  dueDate: string | null
  status: CreditAccountStatus
}

export interface CreditAccountsPage {
  items: CreditAccountListItem[]
  page: number
  pageSize: number
  totalCount: number
  totalPages: number
}

export interface CreditMovementsPage {
  items: CreditMovement[]
  page: number
  pageSize: number
  totalCount: number
  totalPages: number
}

export interface AdminCreditDetail {
  account: {
    userId: string
    balanceCents: number
    creditLimitCents: number
    dueDate: string | null
    user: { fullName: string } | null
  }
}

// ── Subscription ──────────────────────────────────────────────────────────────

export type SubscriptionStatus =
  | 'active'
  | 'past_due'
  | 'canceled'
  | 'unpaid'
  | 'incomplete'
  | 'incomplete_expired'

export interface Subscription {
  id: string
  status: SubscriptionStatus
  model?: 'rental' | 'purchase'
  currentPeriodStart: string
  currentPeriodEnd: string
  cancelAtPeriodEnd: boolean
  canceledAt: string | null
  purchasedAt?: string | null
}

export interface SubscriptionPlan {
  priceCents: number
  currency: 'usd'
  interval: 'month'
}

// ── User Addresses ────────────────────────────────────────────────────────────

export interface UserAddress {
  id: string
  userId: string
  label: string
  line1: string
  line2: string | null
  lat: number
  lng: number
  instructions: string | null
  isDefault: boolean
  createdAt: string
  updatedAt: string
}

export interface CreateAddressInput {
  label: string
  line1: string
  line2?: string
  lat: number
  lng: number
  instructions?: string
}

export type UpdateAddressInput = Partial<CreateAddressInput>
