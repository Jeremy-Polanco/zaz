import { createFileRoute, isRedirect, Link, redirect } from '@tanstack/react-router'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import {
  Button,
  FieldError,
  Input,
  Label,
  SectionHeading,
} from '../components/ui'
import { useInvitePromoter, usePromoters } from '../lib/queries'
import {
  invitePromoterSchema,
  type InvitePromoterInput,
} from '../lib/schemas'
import type { AuthUser } from '../lib/types'
import { TOKEN_KEY, api } from '../lib/api'
import { formatCents } from '../lib/utils'

export const Route = createFileRoute('/super/promoters/')({
  beforeLoad: async () => {
    if (!localStorage.getItem(TOKEN_KEY)) throw redirect({ to: '/login', search: { next: undefined, ref: undefined } })
    try {
      const { data: me } = await api.get<AuthUser>('/auth/me')
      if (me.role !== 'super_admin_delivery') throw redirect({ to: '/' })
    } catch (e) {
      if (isRedirect(e)) throw e
      throw redirect({ to: '/login', search: { next: undefined, ref: undefined } })
    }
  },
  component: SuperPromotersPage,
})

function serverMessage(err: unknown, fallback: string) {
  return (
    (err as Error & { response?: { data?: { message?: string } } })?.response
      ?.data?.message ?? fallback
  )
}

function InviteForm({ onDone }: { onDone: () => void }) {
  const invite = useInvitePromoter()
  const form = useForm<InvitePromoterInput>({
    resolver: zodResolver(invitePromoterSchema),
    defaultValues: { phone: '', fullName: '' },
  })

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await invite.mutateAsync(values)
      form.reset()
      onDone()
    } catch {}
  })

  return (
    <div className="mb-10 border border-ink/15 bg-paper p-6">
      <div className="mb-5 flex items-center justify-between">
        <span className="eyebrow">Nuevo promotor</span>
      </div>

      <form
        onSubmit={onSubmit}
        className="grid grid-cols-1 gap-5 md:grid-cols-2"
      >
        <div>
          <Label htmlFor="phone">Teléfono (E.164)</Label>
          <Input
            id="phone"
            type="tel"
            inputMode="tel"
            placeholder="+18091234567"
            {...form.register('phone')}
          />
          <FieldError message={form.formState.errors.phone?.message} />
        </div>
        <div>
          <Label htmlFor="fullName">Nombre completo</Label>
          <Input
            id="fullName"
            type="text"
            placeholder="María González"
            {...form.register('fullName')}
          />
          <FieldError message={form.formState.errors.fullName?.message} />
        </div>

        {invite.isError && (
          <p className="md:col-span-2 border-l-2 border-bad pl-3 text-sm font-medium text-bad">
            {serverMessage(invite.error, 'No pudimos crear el promotor')}
          </p>
        )}

        <div className="md:col-span-2 flex gap-3">
          <Button type="submit" variant="accent" disabled={invite.isPending}>
            {invite.isPending ? 'Creando…' : 'Crear promotor'}
          </Button>
        </div>
      </form>
    </div>
  )
}

function SuperPromotersPage() {
  const { data: promoters, isPending } = usePromoters()

  if (isPending) {
    return (
      <div className="mx-auto max-w-6xl px-6 py-20 text-center">
        <span className="eyebrow">Cargando…</span>
      </div>
    )
  }

  const list = promoters ?? []

  return (
    <div className="page-rise mx-auto max-w-6xl px-6 py-12">
      <SectionHeading
        eyebrow="Panel · Promotores"
        title={
          <>
            Tus <span className="italic text-brand">promotores.</span>
          </>
        }
        subtitle={`${list.length} promotor${list.length === 1 ? '' : 'es'} activo${list.length === 1 ? '' : 's'}.`}
      />

      <InviteForm onDone={() => {}} />

      <div className="flex flex-col gap-3">
        {list.map((p) => {
          const claimable = p.claimableCents ?? 0
          const pending = p.pendingCents ?? 0
          return (
            <Link
              key={p.id}
              to="/super/promoters/$id"
              params={{ id: p.id }}
              className="group flex flex-col gap-3 border border-ink/15 bg-paper px-5 py-4 transition-colors hover:bg-ink/5 md:flex-row md:items-center md:gap-4"
            >
              <div className="flex-1">
                <p className="display text-lg font-semibold text-ink">
                  {p.fullName}
                </p>
                <p className="text-[0.7rem] uppercase tracking-[0.14em] text-ink-muted">
                  {p.phone ?? '—'} · Creado{' '}
                  {new Date(p.createdAt).toLocaleDateString()}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <span className="nums text-sm tracking-[0.2em] text-ink">
                  {p.referralCode ?? '—'}
                </span>
              </div>
              <div className="md:ml-4">
                <span className="eyebrow">Referidos</span>
                <p className="display text-2xl font-semibold text-ink">
                  {p.referredCount}
                </p>
              </div>
              <div className="md:ml-4">
                <span className="eyebrow">Disponible</span>
                <p
                  className={`display nums text-2xl font-semibold ${
                    claimable > 0 ? 'text-brand' : 'text-ink-muted'
                  }`}
                >
                  {formatCents(claimable)}
                </p>
              </div>
              <div className="md:ml-4">
                <span className="eyebrow">Pendiente</span>
                <p className="display nums text-xl text-ink-muted">
                  {formatCents(pending)}
                </p>
              </div>
              <div className="text-[0.65rem] uppercase tracking-[0.15em] text-ink-muted group-hover:text-brand">
                Ver →
              </div>
            </Link>
          )
        })}

        {list.length === 0 ? (
          <div className="flex flex-col items-center gap-4 border border-dashed border-ink/20 py-20 text-center">
            <span className="eyebrow">Sin promotores</span>
            <p className="display text-2xl text-ink-muted">
              Creá el primer promotor.
            </p>
          </div>
        ) : null}
      </div>
    </div>
  )
}
