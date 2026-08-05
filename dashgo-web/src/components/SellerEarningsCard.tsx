import { formatCents } from '../lib/utils'
import type { SellerEarnings } from '../lib/types'

/**
 * Ingresos de un vendedor.
 *
 * El desglose por método de pago va SIEMPRE visible, no escondido detrás de un
 * "ver más": con tarjeta la plata entró a la empresa y se le debe la comisión;
 * en efectivo alguien ya agarró los billetes. Leer solo el total es cómo se
 * paga de más.
 */
export function SellerEarningsCard({
  earnings,
  compact = false,
}: {
  earnings: SellerEarnings
  compact?: boolean
}) {
  const { byPaymentMethod } = earnings
  const rows = [
    { label: 'Por tarjeta', data: byPaymentMethod.card, hint: 'la empresa cobró' },
    { label: 'En efectivo', data: byPaymentMethod.cash, hint: 'se cobró en mano' },
    {
      label: 'Sin registrar',
      data: byPaymentMethod.unknown,
      hint: 'comisiones viejas',
    },
  ].filter(
    (r) =>
      r.data.pendingCents + r.data.claimableCents + r.data.paidCents > 0,
  )

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-3 gap-2">
        <Stat label="A cobrar" cents={earnings.claimableCents} strong />
        <Stat label="En espera" cents={earnings.pendingCents} />
        <Stat label="Pagado" cents={earnings.paidCents} />
      </div>

      {rows.length > 0 ? (
        <div className="border border-ink/10">
          <p className="border-b border-ink/10 px-3 py-2 text-[0.6rem] uppercase tracking-[0.12em] text-ink-muted">
            Cómo pagó el cliente
          </p>
          <ul className="divide-y divide-ink/5">
            {rows.map((r) => (
              <li
                key={r.label}
                className="flex items-baseline justify-between gap-3 px-3 py-2"
              >
                <span className="text-sm text-ink">
                  {r.label}{' '}
                  <span className="text-[0.65rem] text-ink-muted">
                    · {r.hint}
                  </span>
                </span>
                <span className="nums shrink-0 text-sm font-semibold text-ink">
                  {formatCents(r.data.claimableCents)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {!compact ? (
        <p className="text-[0.7rem] leading-snug text-ink-muted">
          Las comisiones pasan a <strong>A cobrar</strong> a los 90 días de la
          entrega. La columna de la derecha es lo cobrable de cada tipo.
        </p>
      ) : null}
    </div>
  )
}

function Stat({
  label,
  cents,
  strong = false,
}: {
  label: string
  cents: number
  strong?: boolean
}) {
  return (
    <div
      className={`border px-3 py-2 ${
        strong ? 'border-accent-dark bg-accent-light' : 'border-ink/10 bg-paper'
      }`}
    >
      <p className="text-[0.6rem] uppercase tracking-[0.12em] text-ink-muted">
        {label}
      </p>
      <p className="nums mt-0.5 text-lg font-semibold text-ink">
        {formatCents(cents)}
      </p>
    </div>
  )
}
