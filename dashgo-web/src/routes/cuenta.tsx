import { useState } from 'react'
import {
  createFileRoute,
  Link,
  redirect,
  useRouter,
} from '@tanstack/react-router'
import { Button, Card, Input, Label, SectionHeading } from '../components/ui'
import { DeleteAccountModal } from '../components/DeleteAccountModal'
import { useCurrentUser, useDeleteAccount, useLogout } from '../lib/auth'
import { useUpdateMe } from '../lib/queries'
import { TOKEN_KEY } from '../lib/api'

export const Route = createFileRoute('/cuenta')({
  beforeLoad: () => {
    if (!localStorage.getItem(TOKEN_KEY)) {
      throw redirect({ to: '/login', search: { next: undefined, ref: undefined } })
    }
  },
  component: AccountPage,
})

function roleLabel(role: string) {
  if (role === 'super_admin_delivery') return 'Reparto'
  if (role === 'promoter') return 'Promotor'
  return 'Cliente'
}

function serverMessage(err: unknown, fallback: string) {
  return (
    (err as Error & { response?: { data?: { message?: string } } })?.response
      ?.data?.message ?? fallback
  )
}

function AccountPage() {
  const { data: user, isPending } = useCurrentUser()
  const updateMe = useUpdateMe()
  const logout = useLogout()
  const deleteAccount = useDeleteAccount()
  const router = useRouter()

  const [editingName, setEditingName] = useState(false)
  const [name, setName] = useState('')
  const [dob, setDob] = useState('')
  const [showDelete, setShowDelete] = useState(false)

  if (isPending) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-20 text-center">
        <span className="eyebrow">Cargando tu cuenta…</span>
      </div>
    )
  }

  if (!user) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-20 text-center">
        <span className="eyebrow">Sesión expirada</span>
        <p className="mt-3 text-ink-muted">
          <Link to="/login" search={{ next: undefined, ref: undefined }} className="underline">
            Iniciá sesión
          </Link>{' '}
          para ver tu cuenta.
        </p>
      </div>
    )
  }

  const isClient = user.role === 'client'

  const startEdit = () => {
    setName(user.fullName)
    setDob(user.dateOfBirth ?? '')
    setEditingName(true)
  }

  const saveName = async () => {
    const trimmed = name.trim()
    if (trimmed.length < 2) return
    await updateMe.mutateAsync({
      fullName: trimmed,
      // Empty input clears the birthday (explicit null); unchanged sends same value.
      dateOfBirth: dob ? dob : null,
    })
    setEditingName(false)
  }

  const handleLogout = () => {
    logout()
    router.navigate({ to: '/login', search: { next: undefined, ref: undefined } })
  }

  const handleDelete = async () => {
    await deleteAccount.mutateAsync()
    router.navigate({ to: '/login', search: { next: undefined, ref: undefined } })
  }

  return (
    <div className="page-rise mx-auto max-w-3xl px-6 py-12">
      <SectionHeading
        eyebrow="Tu cuenta"
        title={
          <>
            Mi <span className="italic text-brand">perfil.</span>
          </>
        }
      />

      {/* Identity */}
      <Card className="mb-6">
        <div className="flex items-center gap-4">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-ink text-xl font-semibold text-paper">
            {user.fullName?.[0]?.toUpperCase() ?? '·'}
          </div>
          <div className="min-w-0 flex-1">
            {editingName ? (
              <div className="flex flex-col gap-3">
                <div>
                  <Label htmlFor="fullName">Nombre</Label>
                  <Input
                    id="fullName"
                    value={name}
                    autoComplete="name"
                    onChange={(e) => setName(e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="dateOfBirth">
                    Fecha de nacimiento{' '}
                    <span className="text-ink-muted">(opcional)</span>
                  </Label>
                  <Input
                    id="dateOfBirth"
                    type="date"
                    value={dob}
                    autoComplete="bday"
                    onChange={(e) => setDob(e.target.value)}
                  />
                  <p className="mt-1 text-xs text-ink-muted">
                    Para saludarte en tu cumpleaños 🎂
                  </p>
                </div>
                {updateMe.isError && (
                  <p className="text-sm font-medium text-bad">
                    {serverMessage(updateMe.error, 'No pudimos guardar tu nombre')}
                  </p>
                )}
                <div className="flex items-center gap-3">
                  <Button
                    size="sm"
                    onClick={saveName}
                    disabled={updateMe.isPending || name.trim().length < 2}
                  >
                    {updateMe.isPending ? 'Guardando…' : 'Guardar'}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setEditingName(false)}
                    disabled={updateMe.isPending}
                  >
                    Cancelar
                  </Button>
                </div>
              </div>
            ) : (
              <>
                <p className="truncate text-lg font-semibold text-ink">
                  {user.fullName}
                </p>
                {user.phone && (
                  <p className="text-sm text-ink-muted">{user.phone}</p>
                )}
                <span className="eyebrow mt-1 inline-block !text-[0.6rem]">
                  {roleLabel(user.role)}
                </span>
              </>
            )}
          </div>
          {!editingName && (
            <Button size="sm" variant="secondary" onClick={startEdit}>
              Editar
            </Button>
          )}
        </div>
      </Card>

      {/* Client shortcuts */}
      {isClient && (
        <Card className="mb-6">
          <span className="eyebrow">Mis datos</span>
          <nav className="mt-4 flex flex-col divide-y divide-ink/10">
            <AccountLink to="/alquileres" label="Mis alquileres" />
            <AccountLink to="/points" label="Mis puntos" />
            <AccountLink to="/subscription" label="Suscripción" />
          </nav>
        </Card>
      )}

      {/* Danger zone */}
      <div className="mt-10 flex flex-col gap-4 border-t border-ink/10 pt-8">
        <Button variant="secondary" size="lg" onClick={handleLogout}>
          Cerrar sesión →
        </Button>
        <button
          type="button"
          onClick={() => setShowDelete(true)}
          className="self-start text-sm font-medium text-bad underline underline-offset-4 hover:opacity-80"
        >
          Eliminar mi cuenta
        </button>
      </div>

      <DeleteAccountModal
        open={showDelete}
        onClose={() => setShowDelete(false)}
        onConfirm={handleDelete}
        isPending={deleteAccount.isPending}
        errorMessage={
          deleteAccount.isError
            ? serverMessage(deleteAccount.error, 'No pudimos eliminar tu cuenta')
            : null
        }
      />
    </div>
  )
}

function AccountLink({ to, label }: { to: string; label: string }) {
  return (
    <Link
      to={to}
      className="flex items-center justify-between py-4 text-ink transition-colors hover:text-brand"
    >
      <span className="font-medium">{label}</span>
      <span aria-hidden="true">→</span>
    </Link>
  )
}
