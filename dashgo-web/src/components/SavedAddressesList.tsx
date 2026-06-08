import { useSuperUserAddresses } from '../lib/queries'
import type { UserAddress } from '../lib/types'

type Props = {
  userId: string
  /** When provided, each address becomes a button that calls back on click. */
  onPick?: (address: UserAddress) => void
}

export function SavedAddressesList({ userId, onPick }: Props) {
  const { data: addresses, isLoading } = useSuperUserAddresses(userId)

  if (isLoading) {
    return <p className="text-sm text-ink-muted">Cargando…</p>
  }

  if (!addresses || addresses.length === 0) {
    return <p className="text-sm text-ink-muted">Sin direcciones guardadas</p>
  }

  return (
    <ul className="space-y-2">
      {addresses.map((a) => {
        const body = (
          <>
            <div className="min-w-0">
              <span className="font-semibold text-ink">{a.label}</span>
              <span className="ml-2 text-sm text-ink-soft">{a.line1}</span>
            </div>
            {a.isDefault && (
              <span className="shrink-0 text-[0.65rem] uppercase tracking-[0.12em] text-brand">
                Predeterminada
              </span>
            )}
          </>
        )
        return (
          <li key={a.id}>
            {onPick ? (
              <button
                type="button"
                onClick={() => onPick(a)}
                className="flex w-full items-baseline justify-between gap-3 border border-ink/15 px-3 py-2 text-left transition-colors hover:border-brand hover:text-brand"
              >
                {body}
              </button>
            ) : (
              <div className="flex items-baseline justify-between gap-3 border-b border-ink/10 pb-2">
                {body}
              </div>
            )}
          </li>
        )
      })}
    </ul>
  )
}
