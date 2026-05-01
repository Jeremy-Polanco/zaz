import { createFileRoute, Link, redirect } from '@tanstack/react-router'
import { StatusBadge } from '../components/StatusBadge'
import { Button, SectionHeading } from '../components/ui'
import { useOrders } from '../lib/queries'
import { formatDate, formatMoney } from '../lib/utils'
import { TOKEN_KEY } from '../lib/api'

export const Route = createFileRoute('/orders/')({
  beforeLoad: () => {
    if (!localStorage.getItem(TOKEN_KEY)) throw redirect({ to: '/login', search: { next: undefined, ref: undefined } })
  },
  component: OrdersPage,
})

function OrdersPage() {
  const { data: orders, isPending } = useOrders()

  if (isPending) {
    return (
      <div className="mx-auto max-w-6xl px-6 py-20 text-center">
        <span className="eyebrow">Cargando pedidos…</span>
      </div>
    )
  }

  return (
    <div className="page-rise mx-auto max-w-6xl px-6 py-12">
      <SectionHeading
        eyebrow="Historial"
        title={
          <>
            Mis <span className="italic text-brand">pedidos</span>
          </>
        }
        subtitle={
          orders && orders.length > 0
            ? `${orders.length} pedido${orders.length === 1 ? '' : 's'} en total.`
            : 'Todavía no hiciste ningún pedido.'
        }
        action={
          <Link to="/catalog">
            <Button variant="accent">+ Nuevo pedido</Button>
          </Link>
        }
      />

      {orders && orders.length > 0 ? (
        <ul className="flex flex-col gap-4">
          {orders.map((o) => (
            <li
              key={o.id}
              className="group border border-ink/15 bg-paper p-6 transition-all hover:border-ink hover:bg-paper-deep/40"
            >
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-12 sm:items-center">
                <div className="sm:col-span-3">
                  <span className="eyebrow">Fecha</span>
                  <p className="mt-1 text-sm font-medium">
                    {formatDate(o.createdAt)}
                  </p>
                </div>
                <div className="sm:col-span-4">
                  <span className="eyebrow">Entrega</span>
                  <p className="mt-1 text-sm text-ink-soft">
                    {o.deliveryAddress.text}
                  </p>
                </div>
                <div className="sm:col-span-2">
                  <span className="eyebrow">Total</span>
                  <p className="display mt-1 nums text-xl font-semibold">
                    {formatMoney(o.totalAmount)}
                  </p>
                </div>
                <div className="sm:col-span-3 flex flex-col items-start gap-2 sm:items-end">
                  <StatusBadge status={o.status} />
                  <span className="text-[0.65rem] uppercase tracking-[0.15em] text-ink-muted">
                    {o.paymentMethod === 'cash' ? 'Efectivo' : 'Digital'}
                  </span>
                  {o.status === 'delivered' ? (
                    <Link
                      to="/orders/$orderId/invoice"
                      params={{ orderId: o.id }}
                      className="text-[0.65rem] uppercase tracking-[0.14em] text-brand hover:underline"
                    >
                      Ver factura ↗
                    </Link>
                  ) : (
                    <Link
                      to="/orders/$orderId"
                      params={{ orderId: o.id }}
                      className="text-[0.65rem] uppercase tracking-[0.14em] text-brand hover:underline"
                    >
                      Ver detalle ↗
                    </Link>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="flex flex-col items-center gap-4 border border-dashed border-ink/20 py-20 text-center">
          <span className="eyebrow">Sin historial</span>
          <p className="display text-3xl text-ink-muted">
            Todavía no hiciste pedidos.
          </p>
          <Link to="/catalog">
            <Button variant="accent">Hacer mi primer pedido →</Button>
          </Link>
        </div>
      )}
    </div>
  )
}
