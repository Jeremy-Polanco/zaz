import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, clearSession, setSession } from './api'
import { getAccessToken } from './token-storage'
import type {
  AdminCreditDetail,
  AuthorizedIntent,
  AuthUser,
  Category,
  CreditAccountsPage,
  CreditMovementsPage,
  GeoAddress,
  Invoice,
  LoginResponse,
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
} from './types'
import type {
  AdjustCreditInput,
  CheckoutInput,
  GrantCreditInput,
  InvitePromoterInput,
  ManualAdjustmentInput,
  RecordPaymentInput,
  SendOtpInput,
  VerifyOtpInput,
} from './schemas'
import type { OrderStatus } from './types'

export type UpdateMeInput = {
  fullName?: string
  addressDefault?: GeoAddress
}

export type ComputeShippingInput = {
  lat: number
  lng: number
}

export function useCurrentUser() {
  return useQuery<AuthUser | null>({
    queryKey: ['auth', 'me'],
    queryFn: async () => {
      const token = await getAccessToken()
      if (!token) return null
      const { data } = await api.get<AuthUser>('/auth/me')
      return data
    },
    staleTime: 60_000,
    retry: false,
  })
}

export function useSendOtp() {
  return useMutation({
    mutationFn: async (input: SendOtpInput) => {
      const { data } = await api.post<{ sent: boolean; expiresAt: string }>(
        '/auth/otp/send',
        input,
      )
      return data
    },
  })
}

export function useVerifyOtp() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: VerifyOtpInput) => {
      const { data } = await api.post<LoginResponse & { isNewUser: boolean }>(
        '/auth/otp/verify',
        input,
      )
      return data
    },
    onSuccess: async (data) => {
      await setSession(data)
      qc.setQueryData(['auth', 'me'], data.user)
    },
  })
}

export function useLogout() {
  const qc = useQueryClient()
  return async () => {
    await clearSession()
    qc.setQueryData(['auth', 'me'], null)
    qc.invalidateQueries()
  }
}

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

export function useUpdateInventory() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      productId: string
      isAvailable?: boolean
      stock?: number
    }) => {
      const { productId, ...patch } = input
      const { data } = await api.patch<Product>(
        `/products/${productId}/inventory`,
        patch,
      )
      return data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['products'] })
    },
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
    queryFn: async () => (await api.get<PointsBalance>('/points/balance')).data,
  })
}

export function usePointsHistory() {
  return useQuery<PointsEntry[]>({
    queryKey: ['points', 'history'],
    queryFn: async () => (await api.get<PointsEntry[]>('/points/history')).data,
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
    mutationFn: async (input: { id: string; status: OrderStatus }) => {
      const { data } = await api.patch<Order>(`/orders/${input.id}/status`, {
        status: input.status,
      })
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
    mutationFn: async (input: { id: string; shippingCents: number }) => {
      const { data } = await api.patch<Order>(
        `/orders/${input.id}/quote`,
        { shippingCents: input.shippingCents },
      )
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

export interface PaymentIntentResponse {
  paymentIntentId: string
  clientSecret: string
  amount: number
  currency: string
}

export function useCreatePaymentIntent() {
  return useMutation({
    mutationFn: async (input: {
      items: { productId: string; quantity: number }[]
      usePoints?: boolean
      deliveryAddress?: { text: string; lat?: number; lng?: number }
    }) => {
      const { data } = await api.post<PaymentIntentResponse>(
        '/payments/intent',
        input,
      )
      return data
    },
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
    mutationFn: async ({
      id,
      ...input
    }: { id: string } & Partial<CreateProductInput>) => {
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
    queryFn: async () =>
      (await api.get<Payout[]>('/promoters/me/payouts')).data,
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

export function useUpdateMe() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: UpdateMeInput) => {
      const { data } = await api.patch<AuthUser>('/users/me', input)
      return data
    },
    onSuccess: (user) => {
      qc.setQueryData(['auth', 'me'], user)
    },
  })
}

export function useComputeShipping(input: ComputeShippingInput | null) {
  return useQuery<ShippingQuote>({
    queryKey: ['shipping', input],
    queryFn: async () =>
      (await api.post<ShippingQuote>('/shipping/quote', input)).data,
    enabled: !!input,
    retry: false,
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

// ── Credit ("Fiado") ──────────────────────────────────────────────────────────

export function useMyCredit() {
  return useQuery<MyCreditResponse>({
    queryKey: ['credit', 'me'],
    queryFn: async () => (await api.get<MyCreditResponse>('/me/credit')).data,
    staleTime: 30_000,
  })
}

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

export function useAdminCreditAccounts(params: {
  status?: string
  search?: string
  page?: number
  pageSize?: number
}) {
  const { status, search, page, pageSize } = params
  return useQuery<CreditAccountsPage>({
    queryKey: ['credit', 'admin', 'list', status ?? 'all', search ?? '', page ?? 1, pageSize ?? 25],
    queryFn: async () => {
      const q = new URLSearchParams()
      if (status) q.set('status', status)
      if (search) q.set('search', search)
      if (page) q.set('page', String(page))
      if (pageSize) q.set('pageSize', String(pageSize))
      const qs = q.toString()
      const { data } = await api.get<CreditAccountsPage>(
        qs ? `/admin/credit-accounts?${qs}` : '/admin/credit-accounts',
      )
      return data
    },
    staleTime: 10_000,
  })
}

export function useAdminCreditAccount(userId: string | undefined) {
  return useQuery<AdminCreditDetail>({
    queryKey: ['credit', 'admin', userId],
    queryFn: async () =>
      (await api.get<AdminCreditDetail>(`/admin/credit-accounts/${userId}`)).data,
    enabled: !!userId,
    staleTime: 10_000,
  })
}

export function useAdminCreditMovements(
  userId: string | undefined,
  page: number,
  pageSize: number,
) {
  return useQuery<CreditMovementsPage>({
    queryKey: ['credit', 'admin', userId, 'movements', page, pageSize],
    queryFn: async () => {
      const q = new URLSearchParams({ page: String(page), pageSize: String(pageSize) })
      const { data } = await api.get<CreditMovementsPage>(
        `/admin/credit-accounts/${userId}/movements?${q.toString()}`,
      )
      return data
    },
    enabled: !!userId,
    staleTime: 10_000,
  })
}

export function useGrantCredit(userId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: GrantCreditInput) => {
      const { data } = await api.post(`/admin/credit-accounts/${userId}/grant`, input)
      return data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['credit', 'admin', userId] })
      qc.invalidateQueries({ queryKey: ['credit', 'admin', 'list'] })
    },
  })
}

export function useRecordPayment(userId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: RecordPaymentInput) => {
      const { data } = await api.post(`/admin/credit-accounts/${userId}/payment`, input)
      return data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['credit', 'admin', userId] })
      qc.invalidateQueries({ queryKey: ['credit', 'admin', 'list'] })
    },
  })
}

export function useAdjustCredit(userId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: AdjustCreditInput) => {
      const { data } = await api.patch(`/admin/credit-accounts/${userId}`, input)
      return data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['credit', 'admin', userId] })
      qc.invalidateQueries({ queryKey: ['credit', 'admin', 'list'] })
    },
  })
}

export function useManualAdjustment(userId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: ManualAdjustmentInput) => {
      const { data } = await api.post(`/admin/credit-accounts/${userId}/manual`, input)
      return data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['credit', 'admin', userId] })
      qc.invalidateQueries({ queryKey: ['credit', 'admin', 'list'] })
    },
  })
}

export function useRefundCreditOrder(userId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (orderId: string) => {
      const { data } = await api.post(`/admin/credit-accounts/${userId}/refund/${orderId}`)
      return data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['credit', 'admin', userId] })
      qc.invalidateQueries({ queryKey: ['orders'] })
    },
  })
}

export function useCreateCreditAccount(userId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const { data } = await api.post(`/admin/credit-accounts/${userId}`)
      return data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['credit', 'admin', userId] })
      qc.invalidateQueries({ queryKey: ['credit', 'admin', 'list'] })
    },
  })
}

/** Super-admin: GET /users — full list of users (sorted by createdAt DESC) */
export function useUsers() {
  return useQuery<AuthUser[]>({
    queryKey: ['users'],
    queryFn: async () => (await api.get<AuthUser[]>('/users')).data,
    staleTime: 30_000,
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

/** Public: GET /subscription/plan — plan pricing */
export function useSubscriptionPlan() {
  return useQuery<SubscriptionPlan>({
    queryKey: ['subscription', 'plan'],
    queryFn: async () => (await api.get<SubscriptionPlan>('/subscription/plan')).data,
    staleTime: 3_600_000,
  })
}

/** Client: POST /subscription/checkout-session — returns { url } */
export function useCreateCheckoutSession() {
  return useMutation({
    mutationFn: async (opts?: { successUrl?: string; cancelUrl?: string }) => {
      const { data } = await api.post<{ url: string }>('/subscription/checkout-session', {
        successUrl: opts?.successUrl ?? 'zaz://subscription?success=1',
        cancelUrl: opts?.cancelUrl ?? 'zaz://subscription?cancel=1',
      })
      return data
    },
  })
}

/** Client: POST /subscription/portal-session — returns { url } */
export function useCreatePortalSession() {
  return useMutation({
    mutationFn: async () => {
      const { data } = await api.post<{ url: string }>('/subscription/portal-session')
      return data
    },
  })
}

/** Client: POST /subscription/cancel */
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

/** Client: POST /subscription/reactivate */
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
