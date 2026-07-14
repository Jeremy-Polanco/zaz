import { createFileRoute, isRedirect, redirect } from '@tanstack/react-router'
import { Fragment, useMemo, useState } from 'react'
import { SectionHeading } from '../components/ui'
import { UserAddressesPanel } from '../components/UserAddressesPanel'
import { useAdminUsers, useCurrentUser, useDeleteUser } from '../lib/queries'
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

// ── Birthday helpers ────────────────────────────────────────────────────────────

/** dob is YYYY-MM-DD; compare month/day against today in the local (NJ) TZ. */
function isBirthdayToday(dob: string | null | undefined): boolean {
  if (!dob) return false
  const [, m, d] = dob.split('-').map(Number)
  const now = new Date()
  return m === now.getMonth() + 1 && d === now.getDate()
}

function isBirthdayThisMonth(dob: string | null | undefined): boolean {
  if (!dob) return false
  const [, m] = dob.split('-').map(Number)
  return m === new Date().getMonth() + 1
}

const MONTHS_ES = [
  'ene', 'feb', 'mar', 'abr', 'may', 'jun',
  'jul', 'ago', 'sep', 'oct', 'nov', 'dic',
]

function formatBirthday(dob: string): string {
  const [, m, d] = dob.split('-').map(Number)
  return `${d} ${MONTHS_ES[m - 1] ?? ''}`
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

// ── Delete confirmation modal ─────────────────────────────────────────────────

function DeleteUserModal({
  user,
  onCancel,
  onConfirm,
  isDeleting,
  error,
}: {
  user: AdminUser
  onCancel: () => void
  onConfirm: () => void
  isDeleting: boolean
  error: string | null
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-user-title"
    >
      <div className="w-full max-w-md border border-ink/15 bg-paper p-6 shadow-xl">
        <h2
          id="delete-user-title"
          className="text-lg font-semibold text-ink"
        >
          Eliminar usuario
        </h2>
        <p className="mt-3 text-sm text-ink-muted">
          Vas a eliminar a{' '}
          <span className="font-medium text-ink">{user.fullName}</span>
          {user.phone ? ` (${user.phone})` : ''}. Esta acción es{' '}
          <span className="font-medium text-bad">irreversible</span>: se
          borran sus direcciones, suscripción, créditos y puntos. Sus órdenes se
          conservan anonimizadas.
        </p>

        {error && (
          <p className="mt-3 border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad">
            {error}
          </p>
        )}

        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={isDeleting}
            className="border border-ink/20 px-4 py-2 text-sm text-ink-muted transition-colors hover:border-ink/40 disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isDeleting}
            className="bg-bad px-4 py-2 text-sm font-medium text-paper transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {isDeleting ? 'Eliminando…' : 'Eliminar definitivamente'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main page ──────────────────────────────────────────────────────────────────

function SuperUsersPage() {
  const [subscription, setSubscription] = useState<
    AdminUsersSubscriptionFilter | undefined
  >(undefined)
  const [searchText, setSearchText] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<AdminUser | null>(null)
  const [birthdayMonthOnly, setBirthdayMonthOnly] = useState(false)

  const { data: users, isPending } = useAdminUsers(subscription)
  const { data: me } = useCurrentUser()
  const deleteUser = useDeleteUser()

  const filtered = useMemo(() => {
    if (!users) return []
    const q = searchText.trim().toLowerCase()
    let list = users
    if (q) {
      list = list.filter(
        (u) =>
          u.fullName.toLowerCase().includes(q) ||
          (u.phone?.toLowerCase().includes(q) ?? false),
      )
    }
    if (birthdayMonthOnly) {
      list = list.filter((u) => isBirthdayThisMonth(u.dateOfBirth))
    }
    return list
  }, [users, searchText, birthdayMonthOnly])

  const birthdaysToday = useMemo(
    () => (users ?? []).filter((u) => isBirthdayToday(u.dateOfBirth)),
    [users],
  )

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
        <button
          onClick={() => setBirthdayMonthOnly((v) => !v)}
          className={`rounded-full px-3 py-1 text-[11px] uppercase tracking-wide transition-colors ${
            birthdayMonthOnly
              ? 'bg-accent text-brand-dark'
              : 'border border-ink/20 text-ink-muted hover:border-accent hover:text-accent'
          }`}
        >
          🎂 Cumpleaños este mes
        </button>
      </div>

      {birthdaysToday.length > 0 && (
        <div className="mb-6 border-l-4 border-accent bg-accent/10 p-4">
          <p className="text-sm font-semibold text-ink">
            🎂 Hoy cumple{birthdaysToday.length === 1 ? '' : 'n'} años:{' '}
            {birthdaysToday.map((u) => u.fullName).join(', ')}
          </p>
          <p className="mt-1 text-xs text-ink-muted">
            Ya les llegó el saludo automático. Si querés mandarles un regalo,
            coordinalo con su próximo pedido.
          </p>
        </div>
      )}

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
                  Cumpleaños
                </th>
                <th className="p-4 text-left text-[10px] font-medium uppercase tracking-wide text-ink-muted">
                  Suscripción
                </th>
                <th className="p-4 text-right text-[10px] font-medium uppercase tracking-wide text-ink-muted">
                  Direcciones
                </th>
                <th className="p-4 text-right text-[10px] font-medium uppercase tracking-wide text-ink-muted">
                  Acciones
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-ink-muted">
                    Sin usuarios que coincidan
                  </td>
                </tr>
              ) : (
                filtered.map((u) => {
                  const expanded = expandedId === u.id
                  return (
                    <Fragment key={u.id}>
                      <tr className="border-b border-ink/5 transition-colors hover:bg-ink/3">
                        <td className="p-4 font-medium text-ink">{u.fullName}</td>
                        <td className="p-4 text-ink-muted">{u.phone ?? '—'}</td>
                        <td className="hidden p-4 text-ink-muted md:table-cell">{u.email ?? '—'}</td>
                        <td className="hidden p-4 text-[11px] uppercase tracking-wide text-ink-muted sm:table-cell">
                          {u.role}
                        </td>
                        <td className="p-4 whitespace-nowrap">
                          {u.dateOfBirth ? (
                            isBirthdayToday(u.dateOfBirth) ? (
                              <span className="inline-flex items-center gap-1 border border-accent bg-accent/15 px-1.5 py-0.5 text-[0.65rem] font-semibold uppercase tracking-widest text-accent-dark">
                                🎂 ¡Hoy!
                              </span>
                            ) : (
                              <span className="text-ink-muted">
                                {formatBirthday(u.dateOfBirth)}
                              </span>
                            )
                          ) : (
                            <span className="text-ink-muted/50">—</span>
                          )}
                        </td>
                        <td className="p-4">
                          <SubscriptionBadge user={u} />
                        </td>
                        <td className="p-4 text-right">
                          <button
                            type="button"
                            onClick={() =>
                              setExpandedId(expanded ? null : u.id)
                            }
                            aria-expanded={expanded}
                            className="text-[0.65rem] uppercase tracking-[0.12em] text-brand hover:underline"
                          >
                            {expanded ? 'Ocultar' : 'Direcciones'}
                          </button>
                        </td>
                        <td className="p-4 text-right">
                          {me?.id === u.id ? (
                            <span className="text-[0.6rem] uppercase tracking-[0.12em] text-ink-muted/60">
                              Vos
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setPendingDelete(u)}
                              className="text-[0.65rem] uppercase tracking-[0.12em] text-bad hover:underline"
                            >
                              Eliminar
                            </button>
                          )}
                        </td>
                      </tr>
                      {expanded && (
                        <tr className="border-b border-ink/10 bg-ink/3">
                          <td colSpan={8} className="p-4">
                            <UserAddressesPanel userId={u.id} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })
              )}
            </tbody>
          </table>
          </div>
          <div className="border-t border-ink/10 px-4 py-3 text-right text-[11px] text-ink-muted">
            {filtered.length} usuario{filtered.length !== 1 ? 's' : ''}
          </div>
        </div>
      )}

      {pendingDelete && (
        <DeleteUserModal
          user={pendingDelete}
          isDeleting={deleteUser.isPending}
          error={
            deleteUser.isError
              ? 'No se pudo eliminar el usuario. Intentá de nuevo.'
              : null
          }
          onCancel={() => {
            if (deleteUser.isPending) return
            deleteUser.reset()
            setPendingDelete(null)
          }}
          onConfirm={() => {
            deleteUser.mutate(pendingDelete.id, {
              onSuccess: () => {
                setExpandedId((id) => (id === pendingDelete.id ? null : id))
                setPendingDelete(null)
              },
            })
          }}
        />
      )}
    </div>
  )
}
