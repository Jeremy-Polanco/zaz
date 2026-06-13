import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './api'
import type {
  AdminPlanResponse,
  AdminRentalResponse,
  AuthorizedIntent,
  AuthUser,
  Category,
  ChargeLateFeeResponse,
  CreditAccount,
  CreditAccountsPage,
  CreditMovement,
  CreditMovementsPage,
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
  CreateAddressInput,
  Rental,
  RentalFilter,
  ShippingQuote,
  Subscription,
  SubscriptionPlan,
  UpdateAddressInput,
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

/**
 * Client: create a bebedero maintenance order — a single maintenance-service
 * item, paid in cash. Delivering this order resets the maintenance countdown.
 */
export function useRequestMaintenance() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (productId: string) => {
      const { data } = await api.post<Order>('/orders', {
        items: [{ productId, quantity: 1 }],
        paymentMethod: 'cash',
      })
      return data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['orders'] })
      qc.invalidateQueries({ queryKey: ['me', 'rentals'] })
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

/**
 * Super-admin: PATCH /orders/:id/delivery-address — pin the delivery location
 * at delivery time. Customers no longer send an address; the colmado sets it.
 */
export function useSetOrderDeliveryAddress() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      id,
      text,
      lat,
      lng,
      building,
      houseNumber,
      unit,
      reference,
    }: {
      id: string
      text: string
      lat: number
      lng: number
      building?: string
      houseNumber?: string
      unit?: string
      reference?: string
    }) => {
      const { data } = await api.patch<Order>(`/orders/${id}/delivery-address`, {
        text,
        lat: roundCoord(lat),
        lng: roundCoord(lng),
        building,
        houseNumber,
        unit,
        reference,
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
  requiresQuote?: boolean
  offerLabel?: string | null
  offerDiscountPct?: number | null
  offerStartsAt?: string | null
  offerEndsAt?: string | null
  pricingMode?: 'single_payment' | 'rental'
  monthlyRentCents?: number
  lateFeeCents?: number
  stripeProductId?: string | null
  stripePriceId?: string | null
  requiresMaintenance?: boolean
  isMaintenanceService?: boolean
  displayOrder?: number
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

export type ReorderProductsInput = {
  items: { id: string; displayOrder: number }[]
}

export function useReorderProducts() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: ReorderProductsInput) => {
      const { data } = await api.patch<{ updated: number }>(
        '/products/reorder',
        input,
      )
      return data
    },
    // Optimistic: el drag pinta el nuevo orden al instante en TODAS las vistas
    // de productos (catálogo + admin); si el server falla, se revierte.
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: ['products'] })
      const previous = qc.getQueriesData<Product[]>({ queryKey: ['products'] })
      const orderById = new Map(input.items.map((i) => [i.id, i.displayOrder]))
      qc.setQueriesData<Product[]>({ queryKey: ['products'] }, (old) =>
        old
          ? old
              .map((p) => ({
                ...p,
                displayOrder: orderById.get(p.id) ?? p.displayOrder,
              }))
              .sort(
                (a, b) =>
                  a.displayOrder - b.displayOrder ||
                  (b.createdAt ?? '').localeCompare(a.createdAt ?? ''),
              )
          : old,
      )
      return { previous }
    },
    onError: (_err, _input, ctx) => {
      for (const [key, data] of ctx?.previous ?? []) qc.setQueryData(key, data)
    },
    onSettled: () => {
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
        successUrl: opts?.successUrl ?? 'https://app.dashgo.dev/subscription?session=success',
        cancelUrl: opts?.cancelUrl ?? 'https://app.dashgo.dev/subscription?session=canceled',
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

// ── My address book (customer) ───────────────────────────────────────────────

const MY_ADDRESSES_KEY = ['me', 'addresses'] as const

/** GET /me/addresses — the caller's saved addresses (default-first). */
export function useMyAddresses() {
  return useQuery<UserAddress[]>({
    queryKey: MY_ADDRESSES_KEY,
    queryFn: async () => (await api.get<UserAddress[]>('/me/addresses')).data,
    staleTime: 30_000,
  })
}

// Address coordinates are capped at 7 decimal places by the API
// (CreateAddressDto: @IsNumber({ maxDecimalPlaces: 7 })). Browser geolocation
// and Leaflet emit full-precision floats, so round before persisting — otherwise
// the API rejects with "lat must be a number…". 7 decimals ≈ 1 cm, plenty precise.
function roundCoord(n: number): number {
  return Number(n.toFixed(7))
}

/** POST /me/addresses — create a saved address (first one auto-defaults). */
export function useCreateAddress() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: CreateAddressInput) =>
      (
        await api.post<UserAddress>('/me/addresses', {
          ...input,
          lat: roundCoord(input.lat),
          lng: roundCoord(input.lng),
        })
      ).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: MY_ADDRESSES_KEY }),
  })
}

/** PATCH /me/addresses/:id — update whitelisted address fields. */
export function useUpdateAddress() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...patch }: UpdateAddressInput & { id: string }) =>
      (
        await api.patch<UserAddress>(`/me/addresses/${id}`, {
          ...patch,
          ...(patch.lat !== undefined ? { lat: roundCoord(patch.lat) } : {}),
          ...(patch.lng !== undefined ? { lng: roundCoord(patch.lng) } : {}),
        })
      ).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: MY_ADDRESSES_KEY }),
  })
}

/** PATCH /me/addresses/:id/set-default — promote an address to default. */
export function useSetDefaultAddress() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) =>
      (await api.patch<UserAddress>(`/me/addresses/${id}/set-default`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: MY_ADDRESSES_KEY }),
  })
}

/** DELETE /me/addresses/:id — remove an address (promotes most recent). */
export function useDeleteAddress() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/me/addresses/${id}`)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: MY_ADDRESSES_KEY }),
  })
}

// ── My rentals (customer) ────────────────────────────────────────────────────

/** GET /me/rentals — the caller's own rentals. */
export function useMyRentals() {
  return useQuery<Rental[]>({
    queryKey: ['me', 'rentals'],
    queryFn: async () => (await api.get<Rental[]>('/me/rentals')).data,
    staleTime: 30_000,
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

/** Super-admin: POST /admin/users/:userId/addresses — save a location to a customer. */
export function useCreateAddressForUser(userId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: CreateAddressInput) =>
      (
        await api.post<UserAddress>(`/admin/users/${userId}/addresses`, {
          ...input,
          lat: roundCoord(input.lat),
          lng: roundCoord(input.lng),
        })
      ).data,
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['admin', 'users', userId, 'addresses'] }),
  })
}

/** Super-admin: PUT /admin/subscription/plan — update monthly price */
export function useUpdateSubscriptionPlan() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body: { unitAmountCents: number }) => {
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

// ── Rental hooks (admin) ──────────────────────────────────────────────────────

/** Super-admin: GET /admin/rentals — paginated rental list with filters */
export function useAdminRentals(filters: RentalFilter) {
  const q = new URLSearchParams()
  if (filters.status) {
    for (const s of filters.status) q.append('status', s)
  }
  if (filters.userId) q.set('userId', filters.userId)
  if (filters.productId) q.set('productId', filters.productId)
  if (filters.page) q.set('page', String(filters.page))
  if (filters.pageSize) q.set('pageSize', String(filters.pageSize))
  const qs = q.toString()
  return useQuery<AdminRentalResponse[]>({
    queryKey: ['admin', 'rentals', filters],
    // /admin/rentals returns a paginated { items, page, ... } wrapper — unwrap to
    // the items array the page maps over (matches the AdminRentalResponse[] type).
    queryFn: async () =>
      (
        await api.get<{ items: AdminRentalResponse[] }>(
          qs ? `/admin/rentals?${qs}` : '/admin/rentals',
        )
      ).data.items,
  })
}

/** Super-admin: POST /admin/rentals/:id/charge-late-fee */
export function useChargeLateFee() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      rentalId,
      alsoCancel,
    }: {
      rentalId: string
      alsoCancel?: boolean
    }) => {
      const { data } = await api.post<ChargeLateFeeResponse>(
        `/admin/rentals/${rentalId}/charge-late-fee`,
        { alsoCancel },
      )
      return data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'rentals'] })
    },
  })
}

/** Super-admin: POST /admin/rentals/:id/cancel */
export function useCancelRental() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (rentalId: string) => {
      const { data } = await api.post(`/admin/rentals/${rentalId}/cancel`)
      return data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'rentals'] })
    },
  })
}

/** Super-admin: POST /admin/rentals/:id/retry-setup */
export function useRetryRentalSetup() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (rentalId: string) => {
      const { data } = await api.post(`/admin/rentals/${rentalId}/retry-setup`)
      return data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'rentals'] })
    },
  })
}
