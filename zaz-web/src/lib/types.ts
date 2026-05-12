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
  stripePaymentIntentId?: string | null
  paidAt?: string | null
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

export interface LoginResponse {
  accessToken: string
  refreshToken: string
  user: AuthUser
}

export interface PointsBalance {
  pendingCents: number
  claimableCents: number
  redeemedCents: number
  expiredCents: number
}

export type PointsEntryType = 'earned' | 'redeemed' | 'expired'
export type PointsEntryStatus = 'pending' | 'claimable' | 'redeemed' | 'expired'

export interface PointsEntry {
  id: string
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
  deliveryAddress: GeoAddress
  paymentMethod: PaymentMethod
  createdAt: string
}

export interface Invoice {
  id: string
  invoiceNumber: string
  subtotal: string
  pointsRedeemed: string
  shipping: string
  tax: string
  taxRate: string
  total: string
  createdAt: string
  order: InvoiceOrderRef
  customer: InvoiceCustomer
  items: InvoiceItem[]
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

// ── Credit types ─────────────────────────────────────────────────────────────

export type CreditMovementType =
  | 'grant'
  | 'charge'
  | 'reversal'
  | 'payment'
  | 'adjustment'
  | 'adjustment_increase'
  | 'adjustment_decrease'
export type CreditAccountStatus = 'overdue' | 'active' | 'none'

export interface CreditAccount {
  userId: string
  balanceCents: number
  creditLimitCents: number
  dueDate: string | null
  currency: string
  createdAt: string
  updatedAt: string
  /** Joined relation from some endpoints */
  user?: AuthUser
}

export interface CreditMovement {
  id: string
  creditAccountId: string
  type: CreditMovementType
  amountCents: number
  orderId: string | null
  performedByUserId: string | null
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

export interface CreditAccountsPage {
  items: CreditAccount[]
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
  userId: string
  status: SubscriptionStatus
  currentPeriodStart: string
  currentPeriodEnd: string
  cancelAtPeriodEnd: boolean
  canceledAt: string | null
  /** 'rental' | 'purchase' — added in rental-billing phase */
  model: 'rental' | 'purchase'
  /** ISO timestamp — set only for model='purchase' rows */
  purchasedAt: string | null
}

export interface SubscriptionPlan {
  priceCents: number
  currency: 'usd'
  interval: 'month'
}

export interface AdminPlanResponse {
  id: string
  stripeProductId: string
  activeStripePriceId: string
  unitAmountCents: number
  /** Cents price for one-time dispenser purchase (0 = not configured) */
  purchasePriceCents: number
  /** Cents amount charged as late fee (0 = not configured) */
  lateFeeCents: number
  currency: string
  interval: string
  updatedAt: string // ISO timestamp
}

export interface UpdateSubscriptionPlanInput {
  unitAmountCents?: number
  purchasePriceCents?: number
  lateFeeCents?: number
}

// ── Delinquent subscription (admin) ──────────────────────────────────────────

export type DelinquentSubscription = {
  subscriptionId: string
  userId: string
  userName: string
  userPhone: string | null
  daysDelinquent: number
  currentPeriodEnd: string
  rentalAmountCents: number
  status: string
}

export type ChargeLateFeeRequest = {
  alsoCancel: boolean
}

export type ChargeLateFeeResponse = {
  chargedCents: number
  paymentIntentId: string
  subscriptionCanceled: boolean
}

export type AdminUserSubscriptionResponse = {
  subscription: Subscription | null
  hasPaymentMethod: boolean
}

// ── UserAddress ───────────────────────────────────────────────────────────────

export type UserAddress = {
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
