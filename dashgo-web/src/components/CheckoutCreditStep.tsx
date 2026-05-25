import { useMyCredit } from '../lib/queries'
import { formatCents } from '../lib/utils'
import type { UserRole } from '../lib/types'

interface CheckoutCreditStepProps {
  userRole: UserRole | undefined
  subtotalCents: number
  useCredit: boolean
  onToggle: (checked: boolean) => void
}

/**
 * Checkout step 03 — Mi crédito
 *
 * Renders nothing when:
 *   - user role is not CLIENT
 *   - no credit account exists (status === 'none')
 *   - account is overdue (status === 'overdue')
 *
 * When toggled on: computes creditApplied client-side and shows breakdown.
 */
export function CheckoutCreditStep({
  userRole,
  subtotalCents,
  useCredit,
  onToggle,
}: CheckoutCreditStepProps) {
  const { data } = useMyCredit()

  // Only visible for CLIENT role with a usable credit account
  if (userRole !== 'client') return null
  if (!data || data.status === 'none' || data.status === 'overdue') return null
  if (data.balanceCents === null || data.creditLimitCents === null) return null

  const available = data.balanceCents + data.creditLimitCents
  if (available <= 0) return null

  const creditApplied = Math.min(available, subtotalCents)
  const remainder = subtotalCents - creditApplied
  const fullyCovered = remainder === 0

  return (
    <section>
      <div className="mb-4 flex items-center gap-3">
        <span className="text-[0.7rem] uppercase tracking-[0.2em] text-ink-muted">
          03 · Mi crédito
        </span>
        <span className="h-px flex-1 bg-ink/15" />
      </div>
      <div className="border border-ink/15 bg-paper-deep/30 p-5">
        <div className="flex items-baseline justify-between">
          <span className="eyebrow">Crédito disponible</span>
          <span className="display nums text-2xl font-semibold text-brand">
            {formatCents(available)}
          </span>
        </div>
        <label className="mt-4 flex cursor-pointer items-start gap-3 border-t border-ink/10 pt-4">
          <input
            type="checkbox"
            checked={useCredit}
            onChange={(e) => onToggle(e.target.checked)}
            className="mt-1 h-4 w-4 accent-accent"
          />
          <span>
            <span className="text-sm font-medium text-ink">
              Usar mi crédito en este pedido
            </span>
            <span className="mt-1 block text-[0.65rem] uppercase tracking-[0.14em] text-ink-muted">
              Aplica {formatCents(creditApplied)} de crédito
            </span>
          </span>
        </label>

        {useCredit && (
          <div className="mt-4 space-y-1 border-t border-ink/10 pt-4">
            <div className="flex items-baseline justify-between">
              <span className="text-[0.65rem] uppercase tracking-[0.14em] text-brand">
                Crédito aplicado
              </span>
              <span className="nums text-sm font-medium text-brand">
                −{formatCents(creditApplied)}
              </span>
            </div>
            {fullyCovered ? (
              <p className="text-[0.65rem] font-medium uppercase tracking-[0.14em] text-green-600">
                Orden cubierta por crédito — sin cargo a tu tarjeta
              </p>
            ) : (
              <div className="flex items-baseline justify-between">
                <span className="text-[0.65rem] uppercase tracking-[0.14em] text-ink-muted">
                  Resto a pagar
                </span>
                <span className="nums text-sm font-medium text-ink">
                  {formatCents(remainder)}
                </span>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  )
}
