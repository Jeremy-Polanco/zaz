import { createFileRoute, Link, redirect } from '@tanstack/react-router'
import { z } from 'zod'
import { Button, SectionHeading } from '../components/ui'
import { useMyCredit } from '../lib/queries'
import { formatCents, formatDate } from '../lib/utils'
import type { CreditMovement } from '../lib/types'
import { TOKEN_KEY } from '../lib/api'

export const Route = createFileRoute('/credit')({
  validateSearch: z.object({}),
  beforeLoad: () => {
    if (!localStorage.getItem(TOKEN_KEY)) {
      throw redirect({ to: '/login', search: { next: undefined, ref: undefined } })
    }
  },
  component: CreditPage,
})

function movementTypeLabel(type: string) {
  switch (type) {
    case 'grant': return 'Crédito otorgado'
    case 'charge': return 'Cargo'
    case 'reversal': return 'Reversión'
    case 'payment': return 'Pago recibido'
    case 'adjustment': return 'Ajuste'
    case 'adjustment_increase': return 'Ajuste +'
    case 'adjustment_decrease': return 'Ajuste -'
    default: return type
  }
}

function movementAmountClass(type: CreditMovement['type']): string {
  if (type === 'charge' || type === 'adjustment_decrease') return 'text-bad'
  if (type === 'adjustment') return 'text-ink-muted'
  return 'text-ink'
}

function movementSign(type: CreditMovement['type']): string {
  if (type === 'charge' || type === 'adjustment_decrease') return '−'
  if (type === 'adjustment') return '±'
  return '+'
}

function MovementRow({ mv }: { mv: CreditMovement }) {
  return (
    <li className="grid grid-cols-12 items-center gap-4 border-b border-ink/10 py-4">
      <div className="col-span-3">
        <span className="text-[0.65rem] uppercase tracking-[0.15em] text-ink-muted">
          {formatDate(mv.createdAt)}
        </span>
      </div>
      <div className="col-span-5">
        <p className="text-sm font-medium text-ink">{movementTypeLabel(mv.type)}</p>
        {mv.note && (
          <p className="mt-0.5 text-[0.65rem] text-ink-muted">{mv.note}</p>
        )}
      </div>
      <div className="col-span-2">
        <span className="text-[0.65rem] uppercase tracking-[0.12em] text-ink-muted">
          {mv.type}
        </span>
      </div>
      <div className="col-span-2 text-right">
        <span className={`display nums text-lg font-semibold ${movementAmountClass(mv.type)}`}>
          {movementSign(mv.type)}
          {formatCents(mv.amountCents)}
        </span>
      </div>
    </li>
  )
}

function CreditPage() {
  const { data, isPending } = useMyCredit()

  if (isPending) {
    return (
      <div className="mx-auto max-w-6xl px-6 py-20 text-center">
        <span className="eyebrow">Cargando crédito…</span>
      </div>
    )
  }

  const hasAccount = data && data.balanceCents !== null

  return (
    <div className="page-rise mx-auto max-w-6xl px-6 py-12">
      <SectionHeading
        eyebrow="Mi cuenta"
        title={
          <>
            Mi <span className="italic text-brand">crédito.</span>
          </>
        }
        subtitle="Saldo disponible para tus pedidos."
      />

      {hasAccount ? (
        <>
          {data.amountOwedCents > 0 && (
            <div
              className={`mb-8 flex flex-col gap-4 border-l-4 p-5 sm:flex-row sm:items-center sm:justify-between ${
                data.locked
                  ? 'border-bad bg-bad/5'
                  : 'border-accent bg-accent/5'
              }`}
            >
              <div>
                <p className="display text-xl font-semibold text-ink">
                  {data.locked
                    ? 'Tu cuenta está bloqueada por crédito vencido.'
                    : 'Tienes saldo pendiente.'}
                </p>
                <p className="mt-1 text-sm text-ink-muted">
                  Total a pagar:{' '}
                  <span className="font-semibold text-ink">
                    {formatCents(data.amountOwedCents)}
                  </span>
                </p>
              </div>
              <Link to="/credit/pay">
                <Button variant="accent" size="lg">
                  Pagar ahora →
                </Button>
              </Link>
            </div>
          )}
          <div className="mb-10 grid grid-cols-2 gap-4 sm:grid-cols-4">
            {/* Balance */}
            <div className="flex flex-col gap-1 border border-ink/15 bg-paper p-5">
              <span className="eyebrow">Balance</span>
              <span
                className={`display nums text-4xl font-semibold ${
                  (data.balanceCents ?? 0) < 0 ? 'text-bad' : 'text-ink'
                }`}
              >
                {formatCents(data.balanceCents ?? 0)}
              </span>
            </div>
            {/* Credit limit */}
            <div className="flex flex-col gap-1 border border-ink/15 bg-paper p-5">
              <span className="eyebrow">Límite</span>
              <span className="display nums text-4xl font-semibold text-ink">
                {formatCents(data.creditLimitCents ?? 0)}
              </span>
            </div>
            {/* Due date */}
            <div className="flex flex-col gap-1 border border-ink/15 bg-paper p-5">
              <span className="eyebrow">Vencimiento</span>
              <span className="text-lg font-semibold text-ink">
                {data.dueDate ? formatDate(data.dueDate) : '—'}
              </span>
            </div>
            {/* Status badge */}
            <div className="flex flex-col items-start justify-center border border-ink/15 bg-paper p-5">
              {data.status === 'overdue' ? (
                <span className="rounded-full bg-red-100 px-3 py-1 text-xs font-medium uppercase tracking-wide text-red-700">
                  Vencido
                </span>
              ) : data.status === 'active' ? (
                <span className="rounded-full bg-yellow-100 px-3 py-1 text-xs font-medium uppercase tracking-wide text-yellow-700">
                  Al día
                </span>
              ) : (
                <span className="rounded-full bg-green-100 px-3 py-1 text-xs font-medium uppercase tracking-wide text-green-700">
                  Sin deuda
                </span>
              )}
            </div>
          </div>

          {/* Movements */}
          <div className="border border-ink/15 bg-paper p-6">
            <div className="mb-4 flex items-center justify-between border-b border-ink/10 pb-3">
              <span className="eyebrow">Mis movimientos</span>
              <span className="text-[0.65rem] uppercase tracking-[0.15em] text-ink-muted">
                {data.movements.length} movimiento{data.movements.length === 1 ? '' : 's'}
              </span>
            </div>
            {data.movements.length > 0 ? (
              <ul className="flex flex-col">
                {data.movements.map((mv) => (
                  <MovementRow key={mv.id} mv={mv} />
                ))}
              </ul>
            ) : (
              <div className="py-12 text-center">
                <span className="eyebrow">Sin movimientos todavía</span>
                <p className="mt-3 text-ink-muted">
                  Tu historial de crédito aparecerá aquí.
                </p>
              </div>
            )}
          </div>
        </>
      ) : (
        <div className="py-12 text-center">
          <span className="eyebrow">Sin cuenta de crédito</span>
          <p className="mt-3 text-ink-muted">
            No tienes una cuenta de crédito activa. Contacta al administrador.
          </p>
        </div>
      )}
    </div>
  )
}
