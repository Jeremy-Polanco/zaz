import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './api'
import type {
  AdminPlanResponse,
  AdminUserSubscriptionResponse,
  AuthorizedIntent,
  AuthUser,
  Category,
  ChargeLateFeeResponse,
  CreditAccount,
  CreditAccountsPage,
  CreditMovement,
  CreditMovementsPage,
  DelinquentSubscription,
  GeoAddress,
  Invoice,
  MyCreditResponse,
  Order,
  Payout,
  PointsBalance,
  PointsEntry,
  Product,
  Promoter,
  PromoterCommissionEntryStatus,
  PromoterCommissionsPage,
  PromoterDashboard,
  PromoterMyStats,
  PromoterPublicInfo,
  ShippingQuote,
  Subscription,
  SubscriptionPlan,
  UserAddress,
} from './types'
import type {
  AdjustCreditInput,
  CheckoutInput,
  GrantCreditInput,
  InvitePromoterInput,
  ListAccountsQueryInput,
  ManualAdjustmentInput,
  RecordPaymentInput,
} from './schemas'

export function useProducts() {
  return useQuery<Product[]>({
    queryKey: ['products'],
    queryFn: async () => (await api.get<Product[]>('/products')).data,
  })
}

export function useAdminProducts() {
  return useQuery<Product[]>({
    queryKey: ['products', 'admin'],
    queryFn: async () => (await api.get<Product[]>('/products/admin')).data,
  })
}

export function useOrders() {
  return useQuery<Order[]>({
    queryKey: ['orders'],
    queryFn: async () => (await api.get<Order[]>('/orders')).data,
  })
}

export function useCreateOrder() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: CheckoutInput) => {
      const { data } = await api.post<Order>('/orders', input)
      return data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['orders'] })
      qc.invalidateQueries({ queryKey: ['points'] })
    },
  })
}

export function usePointsBalance() {
  return useQuery<PointsBalance>({
    queryKey: ['points', 'balance'],
    queryFn: async () =>
      (await api.get<PointsBalance>('/points/balance')).data,
  })
}

export function usePointsHistory() {
  return useQuery<PointsEntry[]>({
    queryKey: ['points', 'history'],
    queryFn: async () =>
      (await api.get<PointsEntry[]>('/points/history')).data,
  })
}

export function useInvoice(orderId: string | undefined) {
  return useQuery<Invoice>({
    queryKey: ['invoice', orderId],
    queryFn: async () =>
      (await api.get<Invoice>(`/orders/${orderId}/invoice`)).data,
    enabled: !!orderId,
    retry: false,
  })
}

export function useUpdateOrderStatus() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: Order['status'] }) => {
      const { data } = await api.patch<Order>(`/orders/${id}/status`, { status })
      return data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['orders'] })
    },
  })
}

export function useSetOrderQuote() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      id,
      shippingCents,
    }: {
      id: string
      shippingCents: number
    }) => {
      const { data } = await api.patch<Order>(`/orders/${id}/quote`, {
        shippingCents,
      })
      return data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['orders'] })
    },
  })
}

export function useAuthorizeOrder() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { data } = await api.post<AuthorizedIntent>(
        `/orders/${id}/authorize`,
      )
      return data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['orders'] })
    },
  })
}

export function useConfirmCashOrder() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { data } = await api.post<Order>(`/orders/${id}/confirm-cash`)
      return data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['orders'] })
    },
  })
}

/**
 * Confirm a non-Stripe order (cash OR full-credit). Calls the backend
 * /confirm-non-stripe endpoint which moves the order from QUOTED → PENDING_VALIDATION.
 */
export function useConfirmNonStripeOrder() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { data } = await api.post<Order>(`/orders/${id}/confirm-non-stripe`)
      return data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['orders'] })
    },
  })
}

export function useUsers() {
  return useQuery<AuthUser[]>({
    queryKey: ['users'],
    queryFn: async () => (await api.get<AuthUser[]>('/users')).data,
  })
}

export function useCurrentUser() {
  return useQuery<AuthUser>({
    queryKey: ['auth', 'me'],
    queryFn: async () => (await api.get<AuthUser>('/auth/me')).data,
  })
}

export type CreateProductInput = {
  name: string
  description?: string
  priceToPublic: number
  stock?: number
  promoterCommissionPct?: number
  pointsPct?: number
  categoryId?: string | null
  offerLabel?: string | null
  offerDiscountPct?: number | null
  offerStartsAt?: string | null
  offerEndsAt?: string | null
}

export function useCreateProduct() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: CreateProductInput) => {
      const { data } = await api.post<Product>('/products', input)
      return data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['products'] })
    },
  })
}

export function useUpdateProduct() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...input }: { id: string } & Partial<CreateProductInput>) => {
      const { data } = await api.patch<Product>(`/products/${id}`, input)
      return data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['products'] })
    },
  })
}

export function useDeleteProduct() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/products/${id}`)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['products'] })
    },
  })
}

export function useUploadProductImage() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, file }: { id: string; file: File }) => {
      const form = new FormData()
      form.append('file', file)
      const { data } = await api.post<Product>(`/products/${id}/image`, form, {
        // Setting to undefined unsets the api instance's default
        // 'application/json' so the browser can compute the proper
        // multipart/form-data boundary from the FormData body.
        headers: { 'Content-Type': undefined },
      })
      return data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['products'] })
    },
  })
}

export type UpdateInventoryInput = {
  id: string
  isAvailable?: boolean
  stock?: number
}

export function useUpdateInventory() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...patch }: UpdateInventoryInput) => {
      const { data } = await api.patch<Product>(`/products/${id}/inventory`, patch)
      return data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['products'] })
    },
  })
}

export function useCategories() {
  return useQuery<Category[]>({
    queryKey: ['categories'],
    queryFn: async () => (await api.get<Category[]>('/categories')).data,
  })
}

export type CreateCategoryInput = {
  name: string
  slug?: string
  iconEmoji?: string
  displayOrder?: number
}

export function useCreateCategory() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: CreateCategoryInput) => {
      const { data } = await api.post<Category>('/categories', input)
      return data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['categories'] })
    },
  })
}

export function useUpdateCategory() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      id,
      ...patch
    }: { id: string } & Partial<CreateCategoryInput>) => {
      const { data } = await api.patch<Category>(`/categories/${id}`, patch)
      return data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['categories'] })
      qc.invalidateQueries({ queryKey: ['products'] })
    },
  })
}

export function useDeleteCategory() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/categories/${id}`)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['categories'] })
      qc.invalidateQueries({ queryKey: ['products'] })
    },
  })
}

export function useUploadCategoryImage(categoryId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData()
      form.append('file', file)
      const { data } = await api.post<Category>(`/categories/${categoryId}/image`, form, {
        // Setting to undefined unsets the api instance's default
        // 'application/json' so the browser can compute the proper
        // multipart/form-data boundary from the FormData body.
        headers: { 'Content-Type': undefined },
      })
      return data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['categories'] })
    },
  })
}

export function usePromoters() {
  return useQuery<Promoter[]>({
    queryKey: ['promoters'],
    queryFn: async () => (await api.get<Promoter[]>('/promoters')).data,
  })
}

export function useInvitePromoter() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: InvitePromoterInput) => {
      const { data } = await api.post<Promoter>('/promoters/invite', input)
      return data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['promoters'] })
    },
  })
}

export function useMyPromoterStats() {
  return useQuery<PromoterMyStats>({
    queryKey: ['promoters', 'me'],
    queryFn: async () =>
      (await api.get<PromoterMyStats>('/promoters/me')).data,
  })
}

export function usePromoterByCode(code: string | undefined) {
  return useQuery<PromoterPublicInfo>({
    queryKey: ['promoters', 'by-code', code],
    queryFn: async () =>
      (await api.get<PromoterPublicInfo>(`/promoters/by-code/${code}`)).data,
    enabled: !!code,
    retry: false,
  })
}

export function usePromoterDashboard() {
  return useQuery<PromoterDashboard>({
    queryKey: ['promoters', 'me', 'dashboard'],
    queryFn: async () =>
      (await api.get<PromoterDashboard>('/promoters/me/dashboard')).data,
  })
}

export function usePromoterDashboardAsAdmin(promoterId: string | undefined) {
  return useQuery<PromoterDashboard>({
    queryKey: ['promoters', 'admin', promoterId, 'dashboard'],
    queryFn: async () =>
      (
        await api.get<PromoterDashboard>(
          `/promoters/${promoterId}/dashboard`,
        )
      ).data,
    enabled: !!promoterId,
  })
}

export type PromoterCommissionsParams = {
  status?: PromoterCommissionEntryStatus
  page?: number
  pageSize?: number
  promoterId?: string
}

export function usePromoterCommissions(params: PromoterCommissionsParams) {
  const { promoterId, status, page, pageSize } = params
  const path = promoterId
    ? `/promoters/${promoterId}/commissions`
    : '/promoters/me/commissions'
  return useQuery<PromoterCommissionsPage>({
    queryKey: [
      'promoters',
      'commissions',
      promoterId ?? 'me',
      status ?? 'all',
      page ?? 1,
      pageSize ?? 25,
    ],
    queryFn: async () => {
      const q = new URLSearchParams()
      if (status) q.set('status', status)
      if (page) q.set('page', String(page))
      if (pageSize) q.set('pageSize', String(pageSize))
      const qs = q.toString()
      const { data } = await api.get<PromoterCommissionsPage>(
        qs ? `${path}?${qs}` : path,
      )
      return data
    },
  })
}

export function useMyPayouts() {
  return useQuery<Payout[]>({
    queryKey: ['promoters', 'me', 'payouts'],
    queryFn: async () => (await api.get<Payout[]>('/promoters/me/payouts')).data,
  })
}

export function usePromoterPayouts(promoterId: string | undefined) {
  return useQuery<Payout[]>({
    queryKey: ['promoters', 'admin', promoterId, 'payouts'],
    queryFn: async () =>
      (await api.get<Payout[]>(`/promoters/${promoterId}/payouts`)).data,
    enabled: !!promoterId,
  })
}

export type ComputeShippingInput = {
  lat: number
  lng: number
}

export function useComputeShipping(input: ComputeShippingInput | null) {
  return useQuery<ShippingQuote>({
    queryKey: ['shipping', input],
    queryFn: async () => {
      const { data } = await api.post<ShippingQuote>('/shipping/quote', input)
      return data
    },
    enabled: !!input,
    retry: false,
  })
}

export function useUpdateMe() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (patch: {
      fullName?: string
      phone?: string
      addressDefault?: GeoAddress
    }) => {
      const { data } = await api.patch<AuthUser>('/users/me', patch)
      return data
    },
    onSuccess: (data) => {
      qc.setQueryData(['auth', 'me'], data)
    },
  })
}

export function useCreatePayout() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: { promoterId: string; notes?: string }) => {
      const { data } = await api.post<Payout>(
        `/promoters/${input.promoterId}/payout`,
        { notes: input.notes },
      )
      return data
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['promoters'] })
      qc.invalidateQueries({
        queryKey: ['promoters', 'admin', vars.promoterId, 'dashboard'],
      })
      qc.invalidateQueries({
        queryKey: ['promoters', 'admin', vars.promoterId, 'payouts'],
      })
      qc.invalidateQueries({ queryKey: ['promoters', 'commissions'] })
    },
  })
}

// ── Credit hooks ─────────────────────────────────────────────────────────────

/** Client: GET /me/credit — own credit balance + last 20 movements */
export function useMyCredit() {
  return useQuery<MyCreditResponse>({
    queryKey: ['credit', 'me'],
    queryFn: async () => (await api.get<MyCreditResponse>('/me/credit')).data,
    staleTime: 30_000,
  })
}

/** Client: POST /me/credit/payment-intent — create Stripe PI for outstanding balance */
export function useCreateCreditPaymentIntent() {
  return useMutation({
    mutationFn: async () => {
      const { data } = await api.post<{
        paymentIntentId: string
        clientSecret: string
        amount: number
        currency: string
      }>('/me/credit/payment-intent')
      return data
    },
  })
}

/** Super-admin: paginated list of credit accounts */
export function useAdminCreditAccounts(filter?: ListAccountsQueryInput) {
  const q = new URLSearchParams()
  if (filter?.status) q.set('status', filter.status)
  if (filter?.search) q.set('search', filter.search)
  if (filter?.page) q.set('page', String(filter.page))
  if (filter?.pageSize) q.set('pageSize', String(filter.pageSize))
  const qs = q.toString()
  return useQuery<CreditAccountsPage>({
    queryKey: ['credit', 'admin', 'list', filter],
    queryFn: async () =>
      (await api.get<CreditAccountsPage>(qs ? `/admin/credit-accounts?${qs}` : '/admin/credit-accounts')).data,
    staleTime: 10_000,
  })
}

/** Super-admin: account detail + last 50 movements */
export function useAdminCreditAccount(userId: string | undefined) {
  return useQuery<{ account: CreditAccount | null; movements: CreditMovementsPage }>({
    queryKey: ['credit', 'admin', userId],
    queryFn: async () =>
      (await api.get<{ account: CreditAccount | null; movements: CreditMovementsPage }>(
        `/admin/credit-accounts/${userId}`,
      )).data,
    enabled: !!userId,
    staleTime: 10_000,
  })
}

/** Super-admin: paginated movement history */
export function useAdminCreditMovements(
  userId: string | undefined,
  page = 1,
  pageSize = 50,
) {
  return useQuery<CreditMovementsPage>({
    queryKey: ['credit', 'admin', userId, 'movements', page, pageSize],
    queryFn: async () =>
      (await api.get<CreditMovementsPage>(
        `/admin/credit-accounts/${userId}/movements?page=${page}&pageSize=${pageSize}`,
      )).data,
    enabled: !!userId,
    staleTime: 10_000,
  })
}

/** Super-admin: grant credit to a user */
export function useGrantCredit(userId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: GrantCreditInput) => {
      const { data } = await api.post<CreditMovement>(
        `/admin/credit-accounts/${userId}/grant`,
        input,
      )
      return data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['credit', 'admin', userId] })
      qc.invalidateQueries({ queryKey: ['credit', 'admin', 'list'] })
    },
  })
}

/** Super-admin: record a payment from a user */
export function useRecordPayment(userId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: RecordPaymentInput) => {
      const { data } = await api.post<CreditMovement>(
        `/admin/credit-accounts/${userId}/payment`,
        input,
      )
      return data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['credit', 'admin', userId] })
      qc.invalidateQueries({ queryKey: ['credit', 'admin', 'list'] })
    },
  })
}

/** Super-admin: adjust credit limit and/or due date */
export function useAdjustCredit(userId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: AdjustCreditInput) => {
      const { data } = await api.patch<CreditAccount>(
        `/admin/credit-accounts/${userId}`,
        input,
      )
      return data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['credit', 'admin', userId] })
      qc.invalidateQueries({ queryKey: ['credit', 'admin', 'list'] })
    },
  })
}

/** Super-admin: manual balance adjustment */
export function useManualAdjustment(userId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: ManualAdjustmentInput) => {
      const { data } = await api.post<CreditMovement>(
        `/admin/credit-accounts/${userId}/adjustment`,
        input,
      )
      return data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['credit', 'admin', userId] })
      qc.invalidateQueries({ queryKey: ['credit', 'admin', 'list'] })
    },
  })
}

/** Super-admin: refund an order's credit charge */
export function useRefundCreditOrder(userId: string, orderId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const { data } = await api.post<CreditMovement>(
        `/admin/credit-accounts/${userId}/refund/${orderId}`,
      )
      return data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['credit', 'admin', userId] })
      qc.invalidateQueries({ queryKey: ['credit', 'admin', 'list'] })
    },
  })
}

/** Super-admin: upsert (idempotent create) of a credit account */
export function useCreateCreditAccount(userId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const { data } = await api.post<CreditAccount>(
        `/admin/credit-accounts/${userId}`,
      )
      return data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['credit', 'admin', userId] })
      qc.invalidateQueries({ queryKey: ['credit', 'admin', 'list'] })
    },
  })
}

// ── Subscription hooks ────────────────────────────────────────────────────────

/** Client: GET /me/subscription — current subscription or null */
export function useMySubscription() {
  return useQuery<Subscription | null>({
    queryKey: ['me', 'subscription'],
    queryFn: async () => (await api.get<Subscription | null>('/me/subscription')).data,
    staleTime: 30_000,
  })
}

/** Public: GET /subscription/plan — plan pricing details */
export function useSubscriptionPlan() {
  return useQuery<SubscriptionPlan>({
    queryKey: ['subscription', 'plan'],
    queryFn: async () => (await api.get<SubscriptionPlan>('/subscription/plan')).data,
    staleTime: 3_600_000,
  })
}

/** Client: POST /subscription/checkout-session — redirects to Stripe Checkout */
export function useCreateCheckoutSession() {
  return useMutation({
    mutationFn: async (opts?: { successUrl?: string; cancelUrl?: string }) => {
      const { data } = await api.post<{ url: string }>('/subscription/checkout-session', {
        successUrl: opts?.successUrl ?? 'https://app.zaz.com/subscription?session=success',
        cancelUrl: opts?.cancelUrl ?? 'https://app.zaz.com/subscription?session=canceled',
      })
      return data
    },
    onSuccess: (data) => {
      window.location.href = data.url
    },
  })
}

/** Client: POST /subscription/portal-session — redirects to Stripe Customer Portal */
export function useCreatePortalSession() {
  return useMutation({
    mutationFn: async () => {
      const { data } = await api.post<{ url: string }>('/subscription/portal-session')
      return data
    },
    onSuccess: (data) => {
      window.location.href = data.url
    },
  })
}

/** Client: POST /subscription/cancel — cancel at period end */
export function useCancelSubscription() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      await api.post('/subscription/cancel')
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['me', 'subscription'] })
    },
  })
}

/** Client: POST /subscription/reactivate — remove cancel_at_period_end flag */
export function useReactivateSubscription() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      await api.post('/subscription/reactivate')
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['me', 'subscription'] })
    },
  })
}

/** Super-admin: GET /admin/subscription/plan — current plan config */
export function useAdminSubscriptionPlan() {
  return useQuery<AdminPlanResponse>({
    queryKey: ['admin', 'subscription', 'plan'],
    queryFn: async () =>
      (await api.get<AdminPlanResponse>('/admin/subscription/plan')).data,
    staleTime: 0,
  })
}

// ── User addresses (super-admin) ─────────────────────────────────────────────

/** Super-admin: GET /admin/users/:userId/addresses — read-only address list */
export function useSuperUserAddresses(userId: string | undefined) {
  return useQuery<UserAddress[]>({
    queryKey: ['admin', 'users', userId, 'addresses'],
    queryFn: async () =>
      (await api.get<UserAddress[]>(`/admin/users/${userId}/addresses`)).data,
    enabled: !!userId,
    staleTime: 60_000,
  })
}

/** Super-admin: PUT /admin/subscription/plan — update plan price (partial) */
export function useUpdateSubscriptionPlan() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body: {
      unitAmountCents?: number
      purchasePriceCents?: number
      lateFeeCents?: number
    }) => {
      const { data } = await api.put<AdminPlanResponse>(
        '/admin/subscription/plan',
        body,
      )
      return data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'subscription', 'plan'] })
      qc.invalidateQueries({ queryKey: ['subscription', 'plan'] })
    },
  })
}

// ── Admin rental / dispenser hooks ───────────────────────────────────────────

/** Super-admin: GET /admin/subscription/delinquent — list of delinquent rentals */
export function useDelinquentSubscriptions() {
  return useQuery<DelinquentSubscription[]>({
    queryKey: ['admin', 'subscription', 'delinquent'],
    queryFn: async () =>
      (await api.get<DelinquentSubscription[]>('/admin/subscription/delinquent')).data,
    staleTime: 0,
  })
}

/** Super-admin: GET /admin/users/:userId/subscription — current subscription + hasPaymentMethod */
export function useUserSubscription(userId: string | undefined) {
  return useQuery<AdminUserSubscriptionResponse>({
    queryKey: ['admin', 'user', userId, 'subscription'],
    queryFn: async () =>
      (await api.get<AdminUserSubscriptionResponse>(`/admin/users/${userId}/subscription`)).data,
    enabled: !!userId,
    staleTime: 0,
    retry: false,
  })
}

/** Super-admin: POST /admin/subscriptions/:id/charge-late-fee */
export function useChargeLateFee() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      subscriptionId,
      alsoCancel,
    }: {
      subscriptionId: string
      alsoCancel: boolean
    }) => {
      const { data } = await api.post<ChargeLateFeeResponse>(
        `/admin/subscriptions/${subscriptionId}/charge-late-fee`,
        { alsoCancel },
      )
      return data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'subscription', 'delinquent'] })
    },
  })
}

/** Super-admin: POST /admin/subscriptions/:id/cancel */
export function useCancelSubscriptionAdmin() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      subscriptionId,
    }: {
      subscriptionId: string
      userId?: string
    }) => {
      const { data } = await api.post<Subscription>(
        `/admin/subscriptions/${subscriptionId}/cancel`,
      )
      return data
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['admin', 'subscription', 'delinquent'] })
      if (vars.userId) {
        qc.invalidateQueries({ queryKey: ['admin', 'user', vars.userId, 'subscription'] })
      }
    },
  })
}

/** Super-admin: POST /admin/users/:userId/subscription/activate-rental */
export function useActivateAsRental(userId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const { data } = await api.post<Subscription>(
        `/admin/users/${userId}/subscription/activate-rental`,
      )
      return data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'user', userId, 'subscription'] })
      qc.invalidateQueries({ queryKey: ['admin', 'subscription', 'delinquent'] })
    },
  })
}

/** Super-admin: POST /admin/users/:userId/subscription/activate-purchase */
export function useActivateAsPurchase(userId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const { data } = await api.post<Subscription>(
        `/admin/users/${userId}/subscription/activate-purchase`,
      )
      return data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'user', userId, 'subscription'] })
    },
  })
}
