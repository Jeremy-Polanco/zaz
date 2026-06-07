import { createFileRoute, Link, redirect } from '@tanstack/react-router'
import { SectionHeading } from '../components/ui'
import { useMyRentals } from '../lib/queries'
import { formatCents, formatDate } from '../lib/utils'
import type { Rental, RentalStatus } from '../lib/types'
import { TOKEN_KEY } from '../lib/api'

export const Route = createFileRoute('/alquileres')({
  beforeLoad: () => {
    if (!localStorage.getItem(TOKEN_KEY)) {
      throw redirect({ to: '/login', search: { next: undefined, ref: undefined } })
    }
  },
  component: RentalsPage,
})

const STATUS_META: Record<RentalStatus, { label: string; className: string }> = {
  active: { label: 'Activo', className: 'bg-green-100 text-green-800' },
  past_due: { label: 'Atrasado', className: 'bg-orange-100 text-orange-800' },
  unpaid: { label: 'Sin pagar', className: 'bg-red-100 text-red-800' },
  canceled: { label: 'Cancelado', className: 'bg-stone-100 text-stone-500' },
  pending_setup: { label: 'Pendiente', className: 'bg-amber-100 text-amber-800' },
}

function RentalCard({ rental }: { rental: Rental }) {
  const meta = STATUS_META[rental.status]
  return (
    <li className="flex gap-4 border border-ink/15 bg-paper p-4">
      <div className="h-16 w-16 shrink-0 overflow-hidden border border-ink/10 bg-paper-deep">
        {rental.productImageUrl ? (
          <img
            src={rental.productImageUrl}
            alt={rental.productName}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center px-1 text-center text-[0.6rem] uppercase tracking-[0.1em] text-ink-muted">
            {rental.productName.slice(0, 18)}
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <p className="line-clamp-2 text-base font-medium text-ink">
            {rental.productName}
          </p>
          <span
            className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium uppercase tracking-wide ${meta.className}`}
          >
            {meta.label}
          </span>
        </div>
        <p className="display nums mt-1 text-lg font-semibold text-brand">
          {formatCents(rental.monthlyRentCents)}
          <span className="text-sm font-normal text-ink-muted">/mes</span>
        </p>
        {rental.nextChargeAt && (
          <p className="mt-1 text-[0.7rem] uppercase tracking-[0.12em] text-ink-muted">
            Próximo cargo: {formatDate(rental.nextChargeAt)}
          </p>
        )}
        {rental.status === 'pending_setup' && (
          <p className="mt-2 border-l-2 border-accent pl-3 text-sm text-ink-soft">
            Estamos terminando de configurar tu alquiler. Te avisamos cuando esté
            activo.
          </p>
        )}
      </div>
    </li>
  )
}

export function RentalsPage() {
  const { data: rentals, isPending } = useMyRentals()

  if (isPending) {
    return (
      <div className="mx-auto max-w-4xl px-6 py-20 text-center">
        <span className="eyebrow">Cargando alquileres…</span>
      </div>
    )
  }

  const list = rentals ?? []

  return (
    <div className="page-rise mx-auto max-w-4xl px-6 py-12">
      <SectionHeading
        eyebrow="Mi cuenta"
        title={
          <>
            Mis <span className="italic text-brand">alquileres.</span>
          </>
        }
        subtitle="Equipos que alquilás mes a mes."
      />

      {list.length > 0 ? (
        <ul className="flex flex-col gap-4">
          {list.map((r) => (
            <RentalCard key={r.id} rental={r} />
          ))}
        </ul>
      ) : (
        <div className="py-16 text-center">
          <span className="eyebrow">Sin alquileres</span>
          <p className="mt-3 text-ink-muted">No tienes alquileres activos.</p>
          <p className="mt-1 text-sm text-ink-muted">
            Cuando alquiles un producto, lo verás aquí.
          </p>
          <Link
            to="/catalog"
            className="mt-6 inline-block text-sm font-medium text-brand underline underline-offset-4"
          >
            Ver catálogo →
          </Link>
        </div>
      )}
    </div>
  )
}
