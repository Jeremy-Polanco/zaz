import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './api'
import type {
  AdminPlanResponse,
  AdminRentalResponse,
  AdminRentalsSummary,
  AdminUser,
  AdminUsersSubscriptionFilter,
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
  SellerCatalogItem,
  SellerEarnings,
  SellerPayableRow,
  ShippingQuote,
  ShippingRate,
  Subscription,
  SubscriptionPlan,
  SubscriptionTier,
  TransferSellerPortfolioResult,
  UpdateAddressInput,
  UserAddress,
  UserRole,
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

/**
 * Catálogo de un vendedor: qué productos lleva y cuánto gana por cada uno.
 * El super admin puede pedir el de cualquiera; un vendedor solo el suyo (lo
 * decide el servidor).
 */
export function useSellerCatalog(sellerId: string | null) {
  return useQuery<SellerCatalogItem[]>({
    queryKey: ['sellers', sellerId, 'catalog'],
    queryFn: async () =>
      (await api.get<SellerCatalogItem[]>(`/products/sellers/${sellerId}/catalog`))
        .data,
    enabled: !!sellerId,
  })
}

/**
 * Reemplaza el catálogo COMPLETO de un vendedor (no parches por producto):
 * así dos ediciones simultáneas no lo dejan mitad viejo y mitad nuevo.
 */
export function useSetSellerCatalog() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      sellerId,
      items,
    }: {
      sellerId: string
      items: { productId: string; commissionPct: number }[]
    }) => {
      const { data } = await api.put<SellerCatalogItem[]>(
        `/products/sellers/${sellerId}/catalog`,
        { items },
      )
      return data
    },
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: ['sellers', vars.sellerId, 'catalog'] })
      // El catálogo del cliente depende de esto — que se refresque solo.
      void qc.invalidateQueries({ queryKey: ['products'] })
    },
  })
}

/** Ingresos de un vendedor. El vendedor pide los suyos; el admin cualquiera. */
export function useSellerEarnings(sellerId: string | null) {
  return useQuery<SellerEarnings>({
    queryKey: ['sellers', sellerId, 'earnings'],
    queryFn: async () =>
      (await api.get<SellerEarnings>(`/sellers/${sellerId}/earnings`)).data,
    enabled: !!sellerId,
  })
}

/** Super admin: a quién hay que pagarle y cuánto, separado por método. */
export function useSellersPayable() {
  return useQuery<SellerPayableRow[]>({
    queryKey: ['sellers', 'payable'],
    queryFn: async () =>
      (await api.get<SellerPayableRow[]>('/sellers/payable')).data,
  })
}

export type DispatchOrigin = 'device' | 'saved' | 'none'

export type OrdersLocationParams = { lat?: number; lng?: number }

interface OrdersFetchResult {
  orders: Order[]
  /** Response header X-Dispatch-Origin, or null if the API didn't send it. */
  dispatchOrigin: DispatchOrigin | null
}

function ordersQueryKey(params?: OrdersLocationParams) {
  const hasCoords = typeof params?.lat === 'number' && typeof params?.lng === 'number'
  return hasCoords ? (['orders', params!.lat, params!.lng] as const) : (['orders'] as const)
}

function isDispatchOrigin(v: unknown): v is DispatchOrigin {
  return v === 'device' || v === 'saved' || v === 'none'
}

async function fetchOrders(params?: OrdersLocationParams): Promise<OrdersFetchResult> {
  const hasCoords = typeof params?.lat === 'number' && typeof params?.lng === 'number'
  const res = await api.get<Order[]>('/orders', {
    params: hasCoords ? { lat: params!.lat, lng: params!.lng } : undefined,
  })
  const origin = res.headers?.['x-dispatch-origin']
  return {
    orders: res.data,
    dispatchOrigin: isDispatchOrigin(origin) ? origin : null,
  }
}

/**
 * GET /orders. Pass { lat, lng } (both numbers) so the API sorts staff orders
 * nearest-first from that point and computes distanceMiles from it — used by
 * the super-admin dispatch list (src/routes/super.orders.tsx). Customer
 * screens keep calling this with no args: same queryKey ['orders'] as
 * before, unaffected.
 */
export function useOrders(params?: OrdersLocationParams) {
  return useQuery<OrdersFetchResult, Error, Order[]>({
    queryKey: ordersQueryKey(params),
    queryFn: () => fetchOrders(params),
    select: (result) => result.orders,
    // Resolving the device position changes the queryKey (no-coords →
    // coords). Without this, the dispatch list would flash back to a loading
    // state right when geolocation resolves — keep the last list on screen.
    placeholderData: keepPreviousData,
  })
}

/**
 * Reads the `X-Dispatch-Origin` header from the SAME /orders request
 * useOrders makes for the same params — shared queryKey means react-query
 * dedupes this to one fetch, not two. 'none' means the API had neither
 * device coords nor a saved admin location, so the list came back
 * newest-first instead of by distance.
 */
export function useOrdersDispatchOrigin(params?: OrdersLocationParams) {
  return useQuery<OrdersFetchResult, Error, DispatchOrigin | null>({
    queryKey: ordersQueryKey(params),
    queryFn: () => fetchOrders(params),
    select: (result) => result.dispatchOrigin,
    placeholderData: keepPreviousData,
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
    // The PATCH already answers with the updated order — write it straight into
    // the detail cache so the page reflects the new status immediately. Without
    // this, ['order', id] stayed stale, the advance button kept offering the
    // transition that just happened, and a second click hit
    // "Transición inválida: X → X".
    onSuccess: (order, { id }) => {
      qc.setQueryData(['order', id], order)
      qc.invalidateQueries({ queryKey: ['order', id] })
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
      surchargeCents,
      scheduledDeliveryDate,
    }: {
      id: string
      shippingCents: number
      /** Recargo por distancia. Omitido = mantiene el recargo actual del pedido. */
      surchargeCents?: number
      /** 'YYYY-MM-DD'. Omitido = mantiene el día actual; `null` lo desasigna. */
      scheduledDeliveryDate?: string | null
    }) => {
      const { data } = await api.patch<Order>(`/orders/${id}/quote`, {
        shippingCents,
        surchargeCents,
        scheduledDeliveryDate,
      })
      return data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['orders'] })
    },
  })
}

/**
 * Staff: PATCH /orders/:id/delivery-date — assign or unassign (`null`) the day
 * staff plans to deliver the order. Allowed on any status except
 * delivered/cancelled (the API enforces this; the web only hides the control).
 * The API sends the customer a push notification itself — nothing to do here
 * beyond refreshing the caches the order detail/list read from.
 */
export function useSetDeliveryDate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      id,
      scheduledDeliveryDate,
    }: {
      id: string
      scheduledDeliveryDate: string | null
    }) => {
      const { data } = await api.patch<Order>(`/orders/${id}/delivery-date`, {
        scheduledDeliveryDate,
      })
      return data
    },
    onSuccess: (_data, { id }) => {
      qc.invalidateQueries({ queryKey: ['orders'] })
      qc.invalidateQueries({ queryKey: ['order', id] })
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
      postalCode,
    }: {
      id: string
      text: string
      lat: number
      lng: number
      building?: string
      houseNumber?: string
      unit?: string
      reference?: string
      postalCode?: string
    }) => {
      const { data } = await api.patch<Order>(`/orders/${id}/delivery-address`, {
        text,
        lat: roundCoord(lat),
        lng: roundCoord(lng),
        building,
        houseNumber,
        unit,
        reference,
        postalCode,
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

/**
 * Super-admin: GET /users — all users enriched with subscription status.
 * Pass `subscription` to server-side filter to only active subs ('active')
 * or only users without an active sub ('none'); omit for everyone.
 */
export function useAdminUsers(subscription?: AdminUsersSubscriptionFilter) {
  return useQuery<AdminUser[]>({
    queryKey: ['users', 'admin', subscription ?? 'all'],
    queryFn: async () =>
      (
        await api.get<AdminUser[]>('/users', {
          params: subscription ? { subscription } : undefined,
        })
      ).data,
  })
}

export function useCurrentUser() {
  return useQuery<AuthUser>({
    queryKey: ['auth', 'me'],
    queryFn: async () => (await api.get<AuthUser>('/auth/me')).data,
  })
}

/**
 * Super-admin: PATCH /users/:id — asigna (o desasigna, con `null`) el vendedor
 * o el promotor de un cliente, o cambia su rol.
 *
 * Solo el super admin. El servidor lo vuelve a validar: rechaza asignar a un
 * usuario que no tenga el rol correcto (`seller` / `promoter`) y rechaza que
 * alguien sea su propio vendedor o promotor. Este hook no es el permiso — el
 * permiso está en la API.
 */
export function useUpdateUserAdmin() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      id,
      ...patch
    }: {
      id: string
      sellerId?: string | null
      /** Promotor atribuido. `null` lo desasigna. */
      referredById?: string | null
      role?: UserRole
      maintenanceTimerDisabled?: boolean
    }) => {
      const { data } = await api.patch<AdminUser>(`/users/${id}`, patch)
      return data
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['users', 'admin'] })
    },
  })
}

/**
 * Super-admin: POST /users/sellers/:sellerId/transfer — reasigna TODA la
 * cartera de un vendedor a otro de una vez (`toSellerId: null` la deja sin
 * vendedor). Invalida la lista de usuarios admin: los clientes movidos deben
 * reflejar el nuevo vendedor sin recargar la página.
 */
export function useTransferSellerPortfolio() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      sellerId,
      toSellerId,
    }: {
      sellerId: string
      toSellerId: string | null
    }) => {
      const { data } = await api.post<TransferSellerPortfolioResult>(
        `/users/sellers/${sellerId}/transfer`,
        { toSellerId },
      )
      return data
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['users', 'admin'] })
    },
  })
}

/**
 * Super-admin: DELETE /users/:id — irreversibly deletes a user account.
 * Runs the full deletion flow server-side (anonymizes orders, cascades
 * related rows, durable audit). Invalidates the admin users list on success.
 */
export function useDeleteUser() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/users/${id}`)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] })
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
  requiresQuote?: boolean
  offerLabel?: string | null
  offerDiscountPct?: number | null
  offerStartsAt?: string | null
  offerEndsAt?: string | null
  /** Precio en cents para suscriptores activos. null = sin precio de suscriptor. */
  subscriberPriceCents?: number | null
  /** 'standard' paga impuesto, 'exempt' no (agua embotellada en NJ). */
  taxCategory?: 'standard' | 'exempt'
  pricingMode?: 'single_payment' | 'rental'
  monthlyRentCents?: number
  lateFeeCents?: number
  theftFeeCents?: number
  stripeProductId?: string | null
  stripePriceId?: string | null
  requiresMaintenance?: boolean
  isMaintenanceService?: boolean
  isDefaultSubscriberBebedero?: boolean
  isPremiumSubscriberProduct?: boolean
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

/**
 * GET /shipping/rate — the flat shipping rate currently in force (public, no
 * auth needed). Drives the checkout preview and the admin "Tarifa de envío"
 * editor. staleTime keeps it from refetching on every mount — the rate
 * changes rarely, and the admin's own PUT already updates the cache.
 */
export function useShippingRate() {
  return useQuery<ShippingRate>({
    queryKey: ['shipping', 'rate'],
    queryFn: async () =>
      (await api.get<ShippingRate>('/shipping/rate')).data,
    staleTime: 5 * 60_000,
  })
}

/** Super-admin: PUT /shipping/rate — set the general delivery rate. */
export function useUpdateShippingRate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: ShippingRate) => {
      const { data } = await api.put<ShippingRate>('/shipping/rate', input)
      return data
    },
    onSuccess: (data) => {
      qc.setQueryData(['shipping', 'rate'], data)
      qc.invalidateQueries({ queryKey: ['shipping', 'rate'] })
    },
  })
}

export function useUpdateMe() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (patch: {
      fullName?: string
      phone?: string
      addressDefault?: GeoAddress
      dateOfBirth?: string | null
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

/**
 * Público: los planes disponibles. Precios BRUTOS — lo que la persona paga.
 * Lista vacía si todavía no hay ninguno configurado.
 */
export function useSubscriptionPlans() {
  return useQuery<SubscriptionPlan[]>({
    queryKey: ['subscription', 'plans'],
    queryFn: async () =>
      (await api.get<SubscriptionPlan[]>('/subscription/plans')).data,
    staleTime: 3_600_000,
  })
}

/** Client: POST /subscription/checkout-session — redirects to Stripe Checkout */
export function useCreateCheckoutSession() {
  return useMutation({
    mutationFn: async (opts?: {
      successUrl?: string
      cancelUrl?: string
      tier?: SubscriptionTier
    }) => {
      const { data } = await api.post<{ url: string }>('/subscription/checkout-session', {
        successUrl: opts?.successUrl ?? 'https://www.dashgo.dev/subscription?session=success',
        cancelUrl: opts?.cancelUrl ?? 'https://www.dashgo.dev/subscription?session=canceled',
        tier: opts?.tier,
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

/**
 * PATCH /me/addresses/:id/set-active — set the caller's active operating
 * location. For a repartidor (SUPER_ADMIN_DELIVERY) with multiple locations,
 * the active one becomes the shipping origin. Also invalidates the auth/me
 * query so `activeLocationId` in the current-user cache refreshes.
 */
export function useSetActiveLocation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) =>
      (await api.patch<UserAddress>(`/me/addresses/${id}/set-active`)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: MY_ADDRESSES_KEY })
      qc.invalidateQueries({ queryKey: ['auth', 'me'] })
    },
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

/** Super-admin: PATCH /admin/users/:userId/addresses/:id — update a saved address. */
export function useUpdateAddressForUser(userId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      id,
      input,
    }: {
      id: string
      input: UpdateAddressInput
    }) =>
      (
        await api.patch<UserAddress>(
          `/admin/users/${userId}/addresses/${id}`,
          {
            ...input,
            ...(input.lat !== undefined ? { lat: roundCoord(input.lat) } : {}),
            ...(input.lng !== undefined ? { lng: roundCoord(input.lng) } : {}),
          },
        )
      ).data,
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['admin', 'users', userId, 'addresses'] }),
  })
}

/** Super-admin: PATCH /admin/users/:userId/addresses/:id/set-default — promote to default. */
export function useSetDefaultAddressForUser(userId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) =>
      (
        await api.patch<UserAddress>(
          `/admin/users/${userId}/addresses/${id}/set-default`,
        )
      ).data,
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['admin', 'users', userId, 'addresses'] }),
  })
}

/** Super-admin: DELETE /admin/users/:userId/addresses/:id — remove a saved address. */
export function useDeleteAddressForUser(userId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/admin/users/${userId}/addresses/${id}`)
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['admin', 'users', userId, 'addresses'] }),
  })
}

/** Super-admin: PUT /admin/subscription/plan — update monthly price */
/** Todos los planes configurados (standard y, si existe, premium). */
export function useAdminSubscriptionPlans() {
  return useQuery<AdminPlanResponse[]>({
    queryKey: ['admin', 'subscription', 'plans'],
    queryFn: async () =>
      (await api.get<AdminPlanResponse[]>('/admin/subscription/plans')).data,
    staleTime: 0,
  })
}

/**
 * Crea el plan de un tier que todavía no existe — en la práctica, premium.
 * Crea producto y precio REALES en Stripe.
 */
export function useCreateSubscriptionPlan() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body: {
      tier: SubscriptionTier
      unitAmountCents: number
    }) => {
      const { data } = await api.post<AdminPlanResponse>(
        '/admin/subscription/plans',
        body,
      )
      return data
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'subscription'] })
      void qc.invalidateQueries({ queryKey: ['subscription', 'plan'] })
    },
  })
}

export function useUpdateSubscriptionPlan() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body: {
      unitAmountCents: number
      tier?: SubscriptionTier
    }) => {
      const { data } = await api.put<AdminPlanResponse>(
        '/admin/subscription/plan',
        body,
      )
      return data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'subscription'] })
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
  // Keeps the server `total` alongside the page's items — the panel needs it for
  // "N resultados" and for the pagination controls. Discarding it made the page
  // report its own 25-row window as the whole dataset.
  return useQuery<{ items: AdminRentalResponse[]; total: number }>({
    queryKey: ['admin', 'rentals', filters],
    queryFn: async () =>
      (
        await api.get<{ items: AdminRentalResponse[]; total: number }>(
          qs ? `/admin/rentals?${qs}` : '/admin/rentals',
        )
      ).data,
  })
}

/**
 * Super-admin: GET /admin/rentals/summary — global KPI counts.
 *
 * Deliberately unfiltered and unpaginated: the panel cards describe every
 * rental, not the page being shown. The existing rental mutations invalidate
 * the ['admin', 'rentals'] prefix, which covers this key too.
 */
export function useAdminRentalsSummary() {
  return useQuery<AdminRentalsSummary>({
    queryKey: ['admin', 'rentals', 'summary'],
    queryFn: async () =>
      (await api.get<AdminRentalsSummary>('/admin/rentals/summary')).data,
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

/** Super-admin: POST /admin/rentals/:id/charge-theft-fee (one-time replacement fee) */
export function useChargeTheftFee() {
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
        `/admin/rentals/${rentalId}/charge-theft-fee`,
        { alsoCancel },
      )
      return data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'rentals'] })
    },
  })
}

/** Super-admin: POST /admin/rentals/:id/reset-maintenance (restart timer to +90d) */
export function useResetMaintenance() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (rentalId: string) => {
      const { data } = await api.post(`/admin/rentals/${rentalId}/reset-maintenance`)
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

// ── Push broadcast (super admin → Notificar) ─────────────────────────────────

export type BroadcastAudience = 'all' | 'active' | 'lapsed'

export interface BroadcastPreview {
  users: number
  devices: number
}

/** Super-admin: reach counts for the selected audience (UI preview). */
export function useBroadcastPreview(audience: BroadcastAudience) {
  return useQuery<BroadcastPreview>({
    queryKey: ['admin', 'broadcast-preview', audience],
    queryFn: async () =>
      (
        await api.get<BroadcastPreview>(
          `/admin/notifications/broadcast/preview`,
          { params: { audience } },
        )
      ).data,
    staleTime: 30_000,
  })
}

export interface BroadcastResult {
  users: number
  /** Tickets Expo accepted — says nothing about delivery. */
  accepted: number
  /** Receipt verdicts from Expo (APNs/FCM), polled once after sending. */
  delivered: number
  failed: number
  pending: number
  errors: string[]
}

/** Super-admin: POST /admin/notifications/broadcast — send push to audience. */
export function useSendBroadcast() {
  return useMutation({
    mutationFn: async (input: {
      title: string
      body: string
      audience: BroadcastAudience
    }) => {
      const { data } = await api.post<BroadcastResult>(
        '/admin/notifications/broadcast',
        input,
      )
      return data
    },
  })
}

// ── Birthday push message (super admin → Notificar) ──────────────────────────

export interface BirthdayMessage {
  title: string
  body: string
}

export function useBirthdayMessage() {
  return useQuery<BirthdayMessage>({
    queryKey: ['admin', 'birthday-message'],
    queryFn: async () =>
      (await api.get<BirthdayMessage>('/admin/notifications/birthday-message'))
        .data,
  })
}

export function useSaveBirthdayMessage() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: BirthdayMessage) => {
      const { data } = await api.put<BirthdayMessage>(
        '/admin/notifications/birthday-message',
        input,
      )
      return data
    },
    onSuccess: (data) => {
      qc.setQueryData(['admin', 'birthday-message'], data)
    },
  })
}
