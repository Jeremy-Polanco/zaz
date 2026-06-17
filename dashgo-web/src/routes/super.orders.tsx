import { createFileRoute, isRedirect, Link, redirect } from '@tanstack/react-router'
import { useMemo, useState } from 'react'
import { DataTable } from '../components/DataTable'
import { QuoteDrawer } from '../components/QuoteDrawer'
import { OrderLocationDrawer } from '../components/OrderLocationDrawer'
import { OrderAddressModal } from '../components/OrderAddressModal'
import { Button, SectionHeading } from '../components/ui'
import { useOrders, useUpdateOrderStatus } from '../lib/queries'
import { formatDate, formatMoney } from '../lib/utils'
import { formatAddressLine } from '../lib/address'
import type { Order, OrderStatus } from '../lib/types'
import type { ColumnDef } from '@tanstack/react-table'
import { TOKEN_KEY, api } from '../lib/api'
import type { AuthUser } from '../lib/types'
import { SuscriptorBadge } from '../components/SuscriptorBadge'

export const Route = createFileRoute('/super/orders')({
  beforeLoad: async () => {
    if (!localStorage.getItem(TOKEN_KEY)) throw redirect({ to: '/login', search: { next: undefined, ref: undefined } })
    try {
      const { data: me } = await api.get<AuthUser>('/auth/me')
      if (me.role !== 'super_admin_delivery') throw redirect({ to: '/' })
    } catch (e) {
      if (isRedirect(e)) throw e
      throw redirect({ to: '/login', search: { next: undefined, ref: undefined } })
    }
  },
  component: SuperOrdersPage,
})

function nextStatus(current: OrderStatus): OrderStatus | null {
  if (current === 'pending_validation') return 'confirmed_by_colmado'
  if (current === 'confirmed_by_colmado') return 'in_delivery_route'
  if (current === 'in_delivery_route') return 'delivered'
  return null
}

function nextLabel(status: OrderStatus): string {
  if (status === 'pending_validation') return 'Confirmar pedido'
  if (status === 'confirmed_by_colmado') return 'Salir a entregar'
  if (status === 'in_delivery_route') return 'Marcar entregado'
  return ''
}

function Metric({
  label,
  value,
  accent,
}: {
  label: string
  value: number | string
  accent?: boolean
}) {
  return (
    <div className="flex flex-col gap-1 border border-ink/15 bg-paper p-5">
      <span className="eyebrow">{label}</span>
      <span
        className={`display nums text-4xl font-semibold ${
          accent ? 'text-brand' : 'text-ink'
        }`}
      >
        {value}
      </span>
    </div>
  )
}

// Local-day check: an order "de hoy" is one created today in the viewer's
// timezone (admin is in New Jersey, same TZ as the delivery ops).
function isToday(iso: string): boolean {
  const d = new Date(iso)
  const now = new Date()
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  )
}

type ListFilter = 'pending' | 'delivered' | 'all'

function SuperOrdersPage() {
  const { data: orders, isPending } = useOrders()
  const updateStatus = useUpdateOrderStatus()
  const [quotingOrder, setQuotingOrder] = useState<Order | null>(null)
  const [locatingOrder, setLocatingOrder] = useState<Order | null>(null)
  const [detailOrder, setDetailOrder] = useState<Order | null>(null)
  const [listFilter, setListFilter] = useState<ListFilter>('pending')

  const activeStatuses: OrderStatus[] = [
    'pending_quote',
    'quoted',
    'pending_validation',
    'confirmed_by_colmado',
    'in_delivery_route',
  ]
  const pendingRoute = (orders ?? []).filter((o) =>
    activeStatuses.includes(o.status),
  )
  const pendingQuote = (orders ?? []).filter(
    (o) => o.status === 'pending_quote',
  ).length
  const pendingConfirm = (orders ?? []).filter(
    (o) => o.status === 'pending_validation',
  ).length
  const inRoute = (orders ?? []).filter((o) => o.status === 'in_delivery_route').length
  const readyToGo = (orders ?? []).filter((o) => o.status === 'confirmed_by_colmado').length

  // "Hoy" metrics are scoped to orders created today (same-day delivery biz).
  const todayOrders = (orders ?? []).filter((o) => isToday(o.createdAt))
  const delivered = todayOrders.filter((o) => o.status === 'delivered').length

  // List defaults to pending/active work (any day); the filter is the escape
  // hatch to look at today's deliveries or the full history.
  const visibleOrders = (orders ?? []).filter((o) => {
    if (listFilter === 'pending') return activeStatuses.includes(o.status)
    if (listFilter === 'delivered')
      return o.status === 'delivered' && isToday(o.createdAt)
    return true
  })

  const columns = useMemo<ColumnDef<Order>[]>(
    () => [
      {
        header: 'Fecha',
        accessorKey: 'createdAt',
        cell: ({ getValue }) => (
          <span className="nums text-xs text-ink-muted">
            {formatDate(getValue<string>())}
          </span>
        ),
      },
      {
        header: 'Cliente',
        accessorFn: (row) => row.customer?.fullName ?? row.customerId.slice(0, 8),
        cell: ({ getValue }) => (
          <span className="display font-semibold">{getValue<string>()}</span>
        ),
      },
      {
        header: 'Dirección',
        accessorFn: (row) =>
          row.deliveryAddress
            ? formatAddressLine(row.deliveryAddress)
            : 'Sin ubicación',
        cell: ({ getValue, row }) => {
          const addr = row.original.deliveryAddress
          // Show the combined line (address · building · apto/piso). Clicking it
          // opens the read-only details modal. The button stays available even
          // once an address exists, so the colmado can re-pin or add another
          // saved location (parity with the mobile "Fijar/Editar" toggle).
          return (
            <div className="flex flex-col items-start gap-1">
              {addr && (
                <button
                  type="button"
                  onClick={() => setDetailOrder(row.original)}
                  className="text-left text-ink-soft hover:underline"
                >
                  {getValue<string>()}
                </button>
              )}
              <button
                type="button"
                onClick={() => setLocatingOrder(row.original)}
                className="text-[0.7rem] uppercase tracking-[0.12em] text-brand hover:underline"
              >
                {addr ? '📍 Editar ubicación' : '📍 Fijar ubicación'}
              </button>
            </div>
          )
        },
      },
      {
        header: 'Lista de compra',
        id: 'items',
        cell: ({ row }) => {
          const items = row.original.items ?? []
          if (items.length === 0) {
            return <span className="text-ink-muted">—</span>
          }
          return (
            <ul className="space-y-0.5">
              {items.map((item) => (
                <li
                  key={item.id}
                  className="flex items-baseline gap-2 text-[13px] leading-tight"
                >
                  <span className="nums font-semibold text-ink">
                    {item.quantity}×
                  </span>
                  <span className="text-ink-soft">
                    {item.product?.name ?? item.productId.slice(0, 8)}
                  </span>
                </li>
              ))}
            </ul>
          )
        },
      },
      {
        header: 'Ruta',
        id: 'route',
        cell: ({ row }) => {
          const addr = row.original.deliveryAddress
          if (!addr) {
            return (
              <button
                type="button"
                onClick={() => setLocatingOrder(row.original)}
                className="inline-flex items-center border border-brand/40 bg-paper px-2 py-0.5 text-[0.65rem] uppercase tracking-[0.12em] text-brand hover:bg-brand/5"
              >
                📍 Fijar
              </button>
            )
          }
          const hasCoords =
            typeof addr.lat === 'number' && typeof addr.lng === 'number'
          const gmaps = hasCoords
            ? `https://www.google.com/maps/dir/?api=1&destination=${addr.lat},${addr.lng}`
            : `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(addr.text)}`
          const waze = hasCoords
            ? `https://waze.com/ul?ll=${addr.lat},${addr.lng}&navigate=yes`
            : `https://waze.com/ul?q=${encodeURIComponent(addr.text)}&navigate=yes`
          const linkCls =
            'inline-flex items-center border border-ink/20 bg-paper px-2 py-0.5 text-[0.65rem] uppercase tracking-[0.12em] text-ink hover:border-brand hover:text-brand'
          return (
            <div className="flex items-center gap-1.5">
              <a
                href={gmaps}
                target="_blank"
                rel="noopener noreferrer"
                className={linkCls}
                aria-label="Abrir en Google Maps"
              >
                Maps ↗
              </a>
              <a
                href={waze}
                target="_blank"
                rel="noopener noreferrer"
                className={linkCls}
                aria-label="Abrir en Waze"
              >
                Waze ↗
              </a>
              <button
                type="button"
                onClick={() => setLocatingOrder(row.original)}
                className="text-[0.65rem] uppercase tracking-[0.12em] text-ink-muted hover:text-brand"
                aria-label="Editar ubicación"
              >
                📍 Editar
              </button>
            </div>
          )
        },
      },
      {
        header: 'Pago',
        accessorKey: 'paymentMethod',
        cell: ({ getValue }) => (
          <span className="text-[0.7rem] uppercase tracking-[0.12em] text-ink-muted">
            {getValue<string>() === 'cash' ? 'Efectivo' : 'Digital'}
          </span>
        ),
      },
      {
        header: 'Total',
        id: 'total',
        cell: ({ row }) => (
          <div className="flex flex-col items-start gap-1">
            <span className="nums font-semibold">{formatMoney(row.original.totalAmount)}</span>
            <SuscriptorBadge wasSubscriber={row.original.wasSubscriberAtQuote ?? false} />
          </div>
        ),
      },
      {
        header: 'Acciones',
        id: 'actions',
        cell: ({ row }) => {
          // Skip-cotización orders (every item requiresQuote=false, e.g. water)
          // have no shipping to quote — they auto-quote at creation. Hide the
          // cotización UI for them.
          const isSkipQuote =
            (row.original.items?.length ?? 0) > 0 &&
            row.original.items.every(
              (it) => it.product?.requiresQuote === false,
            )
          if (row.original.status === 'delivered') {
            return (
              <Link
                to="/orders/$orderId/invoice"
                params={{ orderId: row.original.id }}
                className="text-[0.7rem] uppercase tracking-[0.12em] text-brand hover:underline"
              >
                Ver factura ↗
              </Link>
            )
          }
          if (row.original.status === 'pending_quote') {
            return (
              <Button
                size="sm"
                variant="accent"
                onClick={() => setQuotingOrder(row.original)}
              >
                Cotizar envío
              </Button>
            )
          }
          if (row.original.status === 'quoted') {
            return (
              <div className="flex flex-col items-start gap-1">
                <span className="text-[0.65rem] uppercase tracking-[0.14em] text-ink-muted">
                  Esperando al cliente
                </span>
                {!isSkipQuote && (
                  <button
                    type="button"
                    onClick={() => setQuotingOrder(row.original)}
                    className="text-[0.65rem] uppercase tracking-[0.12em] text-brand hover:underline"
                  >
                    Ajustar cotización
                  </button>
                )}
              </div>
            )
          }
          const next = nextStatus(row.original.status)
          if (!next) return <span className="text-ink-muted">—</span>
          return (
            <Button
              size="sm"
              variant={row.original.status === 'in_delivery_route' ? 'accent' : 'primary'}
              onClick={() => updateStatus.mutate({ id: row.original.id, status: next })}
            >
              {nextLabel(row.original.status)}
            </Button>
          )
        },
      },
    ],
    [updateStatus],
  )

  if (isPending) {
    return (
      <div className="mx-auto max-w-7xl px-6 py-20 text-center">
        <span className="eyebrow">Cargando…</span>
      </div>
    )
  }

  return (
    <>
      <div className="page-rise mx-auto max-w-7xl px-6 py-12">
        <SectionHeading
          eyebrow="Panel · Reparto"
          title={
            <>
              Ruta de <span className="italic text-brand">entrega</span>
            </>
          }
          subtitle={`${pendingRoute.length} pedido${pendingRoute.length === 1 ? '' : 's'} en ruta · ${todayOrders.length} totales hoy.`}
        />

        <div className="mb-10 grid grid-cols-2 gap-4 sm:grid-cols-5">
          <Metric
            label="Por cotizar"
            value={pendingQuote}
            accent={pendingQuote > 0}
          />
          <Metric
            label="Pendientes de confirmar"
            value={pendingConfirm}
            accent={pendingConfirm > 0}
          />
          <Metric label="Listos para salir" value={readyToGo} accent={readyToGo > 0} />
          <Metric label="En camino" value={inRoute} />
          <Metric label="Entregados hoy" value={delivered} />
        </div>

        <div className="mb-4 flex flex-wrap gap-2">
          {(
            [
              { value: 'pending', label: 'Pendientes' },
              { value: 'delivered', label: 'Entregados hoy' },
              { value: 'all', label: 'Todos' },
            ] as const
          ).map((opt) => (
            <button
              key={opt.value}
              onClick={() => setListFilter(opt.value)}
              className={`rounded-full px-3 py-1 text-[11px] uppercase tracking-wide transition-colors ${
                listFilter === opt.value
                  ? 'bg-accent text-brand-dark'
                  : 'border border-ink/20 text-ink-muted hover:border-accent hover:text-accent'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <DataTable
          data={visibleOrders}
          columns={columns}
          filterPlaceholder="Buscar por cliente, colmado o dirección…"
          emptyMessage={
            listFilter === 'pending'
              ? 'No hay pedidos pendientes.'
              : listFilter === 'delivered'
                ? 'No se entregó ningún pedido hoy.'
                : 'No hay pedidos.'
          }
        />
      </div>

      {/* Drawer rendered as sibling of .page-rise — its `transform` animation
          would otherwise become the containing block for the fixed overlay. */}
      {quotingOrder && (
        <QuoteDrawer
          order={quotingOrder}
          onClose={() => setQuotingOrder(null)}
        />
      )}

      {locatingOrder && (
        <OrderLocationDrawer
          order={locatingOrder}
          onClose={() => setLocatingOrder(null)}
        />
      )}

      {detailOrder && (
        <OrderAddressModal
          order={detailOrder}
          onClose={() => setDetailOrder(null)}
          onEdit={() => {
            setLocatingOrder(detailOrder)
            setDetailOrder(null)
          }}
        />
      )}
    </>
  )
}
