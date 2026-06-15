import { createFileRoute, isRedirect, redirect } from '@tanstack/react-router'
import { useMemo, useState } from 'react'
import { SectionHeading } from '../components/ui'
import { useAdminUsers } from '../lib/queries'
import { TOKEN_KEY, api } from '../lib/api'
import type { AdminUser, AdminUsersSubscriptionFilter, AuthUser } from '../lib/types'

// ── Route definition ───────────────────────────────────────────────────────────

export const Route = createFileRoute('/super/users')({
  beforeLoad: async () => {
    if (!localStorage.getItem(TOKEN_KEY)) {
      throw redirect({ to: '/login', search: { next: undefined, ref: undefined } })
    }
    try {
      const { data: me } = await api.get<AuthUser>('/auth/me')
      if (me.role !== 'super_admin_delivery') throw redirect({ to: '/' })
    } catch (e) {
      if (isRedirect(e)) throw e
      throw redirect({ to: '/login', search: { next: undefined, ref: undefined } })
    }
  },
  component: SuperUsersPage,
})

// ── Subscription badge ──────────────────────────────────────────────────────────

function SubscriptionBadge({ user }: { user: AdminUser }) {
  const active = user.hasActiveSubscription
  const cls = active
    ? 'border-ok/40 bg-ok/10 text-ok'
    : 'border-ink/15 bg-ink/5 text-ink-muted'
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap border px-1.5 py-0.5 text-[0.6rem] font-medium uppercase tracking-[0.10em] ${cls}`}
    >
      {active ? 'Activa' : 'Sin suscripción'}
    </span>
  )
}

// ── Filter options ──────────────────────────────────────────────────────────────

const FILTER_OPTIONS: {
  label: string
  value: AdminUsersSubscriptionFilter | undefined
}[] = [
  { label: 'Todos', value: undefined },
  { label: 'Con suscripción activa', value: 'active' },
  { label: 'Sin suscripción', value: 'none' },
]

// ── Main page ──────────────────────────────────────────────────────────────────

function SuperUsersPage() {
  const [subscription, setSubscription] = useState<
    AdminUsersSubscriptionFilter | undefined
  >(undefined)
  const [searchText, setSearchText] = useState('')

  const { data: users, isPending } = useAdminUsers(subscription)

  const filtered = useMemo(() => {
    if (!users) return []
    const q = searchText.trim().toLowerCase()
    if (!q) return users
    return users.filter(
      (u) =>
        u.fullName.toLowerCase().includes(q) ||
        (u.phone?.toLowerCase().includes(q) ?? false),
    )
  }, [users, searchText])

  return (
    <div className="page-rise mx-auto max-w-6xl px-6 py-12">
      <SectionHeading
        eyebrow="Panel · Usuarios"
        title={
          <>
            Usuarios <span className="italic text-accent">registrados.</span>
          </>
        }
        subtitle={`${filtered.length} resultado${filtered.length === 1 ? '' : 's'}.`}
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input
          type="text"
          placeholder="Buscar por nombre o teléfono..."
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          className="w-full max-w-sm border border-ink/20 bg-paper px-3 py-2 text-sm text-ink placeholder:text-ink-muted focus:outline-none focus:ring-1 focus:ring-accent"
        />
      </div>

      <div className="mb-6 flex flex-wrap gap-2">
        {FILTER_OPTIONS.map((opt) => (
          <button
            key={opt.label}
            onClick={() => setSubscription(opt.value)}
            className={`rounded-full px-3 py-1 text-[11px] uppercase tracking-wide transition-colors ${
              subscription === opt.value
                ? 'bg-accent text-brand-dark'
                : 'border border-ink/20 text-ink-muted hover:border-accent hover:text-accent'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {isPending ? (
        <div className="py-20 text-center">
          <span className="eyebrow">Cargando…</span>
        </div>
      ) : (
        <div className="border border-ink/15 bg-paper">
          <div className="overflow-x-auto">
          <table className="w-full min-w-88 text-sm">
            <thead>
              <tr className="border-b border-ink/10">
                <th className="p-4 text-left text-[10px] font-medium uppercase tracking-wide text-ink-muted">
                  Nombre
                </th>
                <th className="p-4 text-left text-[10px] font-medium uppercase tracking-wide text-ink-muted">
                  Tel
                </th>
                <th className="hidden p-4 text-left text-[10px] font-medium uppercase tracking-wide text-ink-muted md:table-cell">
                  Email
                </th>
                <th className="hidden p-4 text-left text-[10px] font-medium uppercase tracking-wide text-ink-muted sm:table-cell">
                  Rol
                </th>
                <th className="p-4 text-left text-[10px] font-medium uppercase tracking-wide text-ink-muted">
                  Suscripción
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-12 text-center text-ink-muted">
                    Sin usuarios que coincidan
                  </td>
                </tr>
              ) : (
                filtered.map((u) => (
                  <tr
                    key={u.id}
                    className="border-b border-ink/5 transition-colors hover:bg-ink/3"
                  >
                    <td className="p-4 font-medium text-ink">{u.fullName}</td>
                    <td className="p-4 text-ink-muted">{u.phone ?? '—'}</td>
                    <td className="hidden p-4 text-ink-muted md:table-cell">{u.email ?? '—'}</td>
                    <td className="hidden p-4 text-[11px] uppercase tracking-wide text-ink-muted sm:table-cell">
                      {u.role}
                    </td>
                    <td className="p-4">
                      <SubscriptionBadge user={u} />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          </div>
          <div className="border-t border-ink/10 px-4 py-3 text-right text-[11px] text-ink-muted">
            {filtered.length} usuario{filtered.length !== 1 ? 's' : ''}
          </div>
        </div>
      )}
    </div>
  )
}
