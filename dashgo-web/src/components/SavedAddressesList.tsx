import { useSuperUserAddresses } from '../lib/queries'

type Props = { userId: string }

export function SavedAddressesList({ userId }: Props) {
  const { data: addresses, isLoading } = useSuperUserAddresses(userId)

  if (isLoading) {
    return <p className="text-sm text-ink-muted">Cargando…</p>
  }

  if (!addresses || addresses.length === 0) {
    return <p className="text-sm text-ink-muted">Sin direcciones guardadas</p>
  }

  return (
    <ul className="space-y-2">
      {addresses.map((a) => (
        <li
          key={a.id}
          className="flex items-baseline justify-between gap-3 border-b border-ink/10 pb-2"
        >
          <div>
            <span className="font-semibold text-ink">{a.label}</span>
            <span className="ml-2 text-sm text-ink-soft">{a.line1}</span>
          </div>
          {a.isDefault && (
            <span className="text-[0.65rem] uppercase tracking-[0.12em] text-brand">
              Predeterminada
            </span>
          )}
        </li>
      ))}
    </ul>
  )
}
