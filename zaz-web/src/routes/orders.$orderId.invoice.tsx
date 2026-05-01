import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { Button } from '../components/ui'
import { useInvoice } from '../lib/queries'
import { formatDate, formatMoney } from '../lib/utils'
import { TOKEN_KEY } from '../lib/api'

export const Route = createFileRoute('/orders/$orderId/invoice')({
  beforeLoad: () => {
    if (!localStorage.getItem(TOKEN_KEY)) throw redirect({ to: '/login', search: { next: undefined, ref: undefined } })
  },
  component: InvoicePage,
})

function InvoicePage() {
  const { orderId } = Route.useParams()
  const navigate = useNavigate()
  const { data: invoice, isPending, isError, error } = useInvoice(orderId)

  if (isPending) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-20 text-center">
        <span className="eyebrow">Cargando factura…</span>
      </div>
    )
  }

  if (isError || !invoice) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-20 text-center">
        <span className="eyebrow">Factura no disponible</span>
        <p className="mt-4 text-ink-muted">
          {(error as Error & {
            response?: { data?: { message?: string } }
          })?.response?.data?.message ??
            'La factura aún no fue generada. Se genera cuando el pedido se marca como entregado.'}
        </p>
      </div>
    )
  }

  const taxRatePct = (parseFloat(invoice.taxRate) * 100).toFixed(3)

  return (
    <>
      <div className="no-print bg-paper-deep/40 py-6 print:hidden">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6">
          <Button variant="ghost" size="sm" onClick={() => navigate({ to: '/orders' })}>
            ← Volver
          </Button>
          <Button variant="accent" size="sm" onClick={() => window.print()}>
            Imprimir factura
          </Button>
        </div>
      </div>

      <div className="page-rise mx-auto max-w-3xl bg-paper px-10 py-12 print:py-8">
        <header className="flex items-start justify-between border-b-2 border-ink pb-8">
          <div>
            <span className="eyebrow">Factura</span>
            <h1 className="display mt-3 text-5xl font-semibold tracking-[-0.03em] text-ink">
              Zaz
            </h1>
            <p className="mt-2 text-[0.7rem] uppercase tracking-[0.18em] text-ink-muted">
              Agua al timbre · New York
            </p>
          </div>
          <div className="text-right">
            <span className="eyebrow">Nº</span>
            <p className="display mt-2 nums text-2xl font-semibold text-ink">
              {invoice.invoiceNumber}
            </p>
            <p className="mt-1 text-[0.65rem] uppercase tracking-[0.14em] text-ink-muted">
              {formatDate(invoice.createdAt)}
            </p>
          </div>
        </header>

        <section className="mt-8 grid grid-cols-2 gap-8 border-b border-ink/10 pb-8">
          <div>
            <span className="eyebrow">Facturado a</span>
            <p className="mt-2 display text-xl font-semibold text-ink">
              {invoice.customer.fullName}
            </p>
            <p className="mt-1 nums text-sm text-ink-soft">
              {invoice.customer.phone ?? '—'}
            </p>
          </div>
          <div>
            <span className="eyebrow">Entrega</span>
            <p className="mt-2 text-sm text-ink">
              {invoice.order.deliveryAddress.text}
            </p>
            <p className="mt-1 text-[0.65rem] uppercase tracking-[0.14em] text-ink-muted">
              {invoice.order.paymentMethod === 'cash' ? 'Pago en efectivo' : 'Pago digital'}
            </p>
          </div>
        </section>

        <section className="mt-8">
          <span className="eyebrow">Detalle</span>
          <table className="mt-4 w-full border-collapse">
            <thead>
              <tr className="border-b border-ink/20">
                <th className="py-2 text-left text-[0.65rem] font-normal uppercase tracking-[0.18em] text-ink-muted">
                  Producto
                </th>
                <th className="py-2 text-right text-[0.65rem] font-normal uppercase tracking-[0.18em] text-ink-muted">
                  Cant.
                </th>
                <th className="py-2 text-right text-[0.65rem] font-normal uppercase tracking-[0.18em] text-ink-muted">
                  P. unit.
                </th>
                <th className="py-2 text-right text-[0.65rem] font-normal uppercase tracking-[0.18em] text-ink-muted">
                  Total
                </th>
              </tr>
            </thead>
            <tbody>
              {invoice.items.map((item) => (
                <tr key={item.id} className="border-b border-ink/5">
                  <td className="py-3 text-sm text-ink">{item.productName}</td>
                  <td className="py-3 text-right nums text-sm text-ink">
                    {item.quantity}
                  </td>
                  <td className="py-3 text-right nums text-sm text-ink-soft">
                    {formatMoney(item.priceAtOrder)}
                  </td>
                  <td className="py-3 text-right nums text-sm font-medium text-ink">
                    {formatMoney(item.lineTotal)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="mt-8 ml-auto max-w-sm">
          <dl className="space-y-2">
            <div className="flex justify-between border-b border-ink/10 pb-2">
              <dt className="text-[0.7rem] uppercase tracking-[0.15em] text-ink-muted">
                Subtotal
              </dt>
              <dd className="nums text-sm text-ink">
                {formatMoney(invoice.subtotal)}
              </dd>
            </div>
            {parseFloat(invoice.pointsRedeemed) > 0 && (
              <div className="flex justify-between border-b border-ink/10 pb-2">
                <dt className="text-[0.7rem] uppercase tracking-[0.15em] text-brand">
                  Descuento por puntos
                </dt>
                <dd className="nums text-sm text-brand">
                  −{formatMoney(invoice.pointsRedeemed)}
                </dd>
              </div>
            )}
            <div className="flex justify-between border-b border-ink/10 pb-2">
              <dt className="text-[0.7rem] uppercase tracking-[0.15em] text-ink-muted">
                Envío
              </dt>
              <dd className="nums text-sm text-ink">
                {parseFloat(invoice.shipping) > 0
                  ? formatMoney(invoice.shipping)
                  : 'Gratis'}
              </dd>
            </div>
            <div className="flex justify-between border-b border-ink/10 pb-2">
              <dt className="text-[0.7rem] uppercase tracking-[0.15em] text-ink-muted">
                Impuestos ({taxRatePct}%)
              </dt>
              <dd className="nums text-sm text-ink">
                {formatMoney(invoice.tax)}
              </dd>
            </div>
            <div className="flex justify-between border-t-2 border-ink pt-3">
              <dt className="eyebrow">Total</dt>
              <dd className="display nums text-3xl font-semibold text-brand">
                {formatMoney(invoice.total)}
              </dd>
            </div>
          </dl>
        </section>

        <footer className="mt-16 border-t border-ink/10 pt-6 text-center">
          <p className="text-[0.65rem] uppercase tracking-[0.2em] text-ink-muted">
            Gracias por tu pedido
          </p>
          <p className="mt-2 text-[0.6rem] uppercase tracking-[0.14em] text-ink-muted">
            Zaz · zaz.com
          </p>
        </footer>
      </div>

      <style>{`
        @media print {
          header, footer, nav, .no-print { display: none !important; }
          body { background: white !important; }
        }
      `}</style>
    </>
  )
}
