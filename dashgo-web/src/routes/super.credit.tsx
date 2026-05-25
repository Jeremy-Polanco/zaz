import {
  createFileRoute,
  isRedirect,
  Link,
  redirect,
} from '@tanstack/react-router'
import { useMemo, useState } from 'react'
import { z } from 'zod'
import { listAccountsQuerySchema } from '../lib/schemas'
import { useAdminCreditAccounts, useUsers } from '../lib/queries'
import { formatCents, formatDate } from '../lib/utils'
import { TOKEN_KEY, api } from '../lib/api'
import type { AuthUser } from '../lib/types'
import { SectionHeading } from '../components/ui'

export const Route = createFileRoute('/super/credit')({
  validateSearch: z.object(listAccountsQuerySchema.shape),
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
  component: SuperCreditPage,
})

type RowStatus = 'sin-cuenta' | 'sin-deuda' | 'al-dia' | 'vencido'

type UserCreditRow = {
  userId: string
  fullName: string
  phone: string | null
  role: string
  balanceCents: number | null
  dueDate: string | null
  status: RowStatus
}

const STATUS_LABEL: Record<RowStatus, string> = {
  'sin-cuenta': 'Sin cuenta',
  'sin-deuda': 'Sin deuda',
  'al-dia': 'Al día',
  vencido: 'Vencido',
}

const STATUS_BADGE: Record<RowStatus, string> = {
  'sin-cuenta': 'bg-ink/5 text-ink-muted',
  'sin-deuda': 'bg-green-100 text-green-700',
  'al-dia': 'bg-yellow-100 text-yellow-700',
  vencido: 'bg-red-100 text-red-700',
}

function StatusBadge({ status }: { status: RowStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${STATUS_BADGE[status]}`}
    >
      {STATUS_LABEL[status]}
    </span>
  )
}

function deriveStatus(
  account: { balanceCents: number; dueDate: string | null } | undefined,
  now: Date,
): RowStatus {
  if (!account) return 'sin-cuenta'
  if (account.balanceCents >= 0) return 'sin-deuda'
  if (account.dueDate && new Date(account.dueDate) < now) return 'vencido'
  return 'al-dia'
}

function SuperCreditPage() {
  const [statusFilter, setStatusFilter] = useState<RowStatus | undefined>(undefined)
  const [searchText, setSearchText] = useState('')
  const now = useMemo(() => new Date(), [])

  const { data: allUsers, isPending: usersPending } = useUsers()
  const { data: allAccounts, isPending: accountsPending } = useAdminCreditAccounts({
    pageSize: 1000,
  })

  const merged = useMemo<UserCreditRow[]>(() => {
    if (!allUsers) return []
    const accountByUserId = new Map(
      (allAccounts?.items ?? []).map((a) => [a.userId, a]),
    )
    return allUsers.map((u) => {
      const account = accountByUserId.get(u.id)
      return {
        userId: u.id,
        fullName: u.fullName,
        phone: u.phone,
        role: u.role,
        balanceCents: account?.balanceCents ?? null,
        dueDate: account?.dueDate ?? null,
        status: deriveStatus(account, now),
      }
    })
  }, [allUsers, allAccounts?.items, now])

  const filtered = useMemo(() => {
    let list = merged
    if (statusFilter) list = list.filter((u) => u.status === statusFilter)
    const q = searchText.trim().toLowerCase()
    if (q) {
      list = list.filter(
        (u) =>
          u.fullName.toLowerCase().includes(q) ||
          (u.phone?.toLowerCase().includes(q) ?? false),
      )
    }
    return list
  }, [merged, statusFilter, searchText])

  const filterOptions: { label: string; value: RowStatus | undefined }[] = [
    { label: 'Todos', value: undefined },
    { label: 'Sin cuenta', value: 'sin-cuenta' },
    { label: 'Vencidos', value: 'vencido' },
    { label: 'Al día', value: 'al-dia' },
    { label: 'Sin deuda', value: 'sin-deuda' },
  ]

  const isPending = usersPending || accountsPending

  return (
    <div className="page-rise mx-auto max-w-6xl px-6 py-12">
      <SectionHeading
        eyebrow="Super admin"
        title={
          <>
            Crédito <span className="italic text-brand">fiado.</span>
          </>
        }
        subtitle="Haz clic en un usuario para gestionar su crédito."
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
        {filterOptions.map((opt) => (
          <button
            key={opt.label}
            onClick={() => setStatusFilter(opt.value)}
            className={`rounded-full px-3 py-1 text-[11px] uppercase tracking-wide transition-colors ${
              statusFilter === opt.value
                ? 'bg-accent text-white'
                : 'border border-ink/20 text-ink-muted hover:border-brand hover:text-brand'
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
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-ink/10">
                <th className="p-4 text-left text-[10px] font-medium uppercase tracking-wide text-ink-muted">
                  Usuario
                </th>
                <th className="p-4 text-left text-[10px] font-medium uppercase tracking-wide text-ink-muted">
                  Tel
                </th>
                <th className="p-4 text-left text-[10px] font-medium uppercase tracking-wide text-ink-muted">
                  Rol
                </th>
                <th className="p-4 text-right text-[10px] font-medium uppercase tracking-wide text-ink-muted">
                  Balance
                </th>
                <th className="p-4 text-left text-[10px] font-medium uppercase tracking-wide text-ink-muted">
                  Vencimiento
                </th>
                <th className="p-4 text-left text-[10px] font-medium uppercase tracking-wide text-ink-muted">
                  Estado
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-ink-muted">
                    Sin usuarios que coincidan
                  </td>
                </tr>
              ) : (
                filtered.map((row) => (
                  <tr
                    key={row.userId}
                    className="border-b border-ink/5 hover:bg-ink/3 cursor-pointer transition-colors"
                  >
                    <td className="p-4">
                      <Link
                        to="/super/credit/$userId"
                        params={{ userId: row.userId }}
                        className="font-medium text-ink hover:text-brand"
                      >
                        {row.fullName}
                      </Link>
                    </td>
                    <td className="p-4 text-ink-muted">{row.phone ?? '—'}</td>
                    <td className="p-4 text-[11px] uppercase tracking-wide text-ink-muted">
                      {row.role}
                    </td>
                    <td
                      className={`p-4 text-right tabular-nums font-medium ${
                        row.balanceCents !== null && row.balanceCents < 0
                          ? 'text-red-600'
                          : 'text-ink'
                      }`}
                    >
                      {row.balanceCents !== null ? formatCents(row.balanceCents) : '—'}
                    </td>
                    <td className="p-4 text-ink-muted">
                      {row.dueDate ? formatDate(row.dueDate) : '—'}
                    </td>
                    <td className="p-4">
                      <StatusBadge status={row.status} />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          <div className="border-t border-ink/10 px-4 py-3 text-right text-[11px] text-ink-muted">
            {filtered.length} usuario{filtered.length !== 1 ? 's' : ''}
          </div>
        </div>
      )}
    </div>
  )
}
