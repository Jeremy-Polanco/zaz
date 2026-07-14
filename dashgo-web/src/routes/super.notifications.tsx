import { useState } from 'react'
import {
  createFileRoute,
  isRedirect,
  redirect,
} from '@tanstack/react-router'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { TOKEN_KEY, api } from '../lib/api'
import type { AuthUser } from '../lib/types'
import {
  useBirthdayMessage,
  useBroadcastPreview,
  useSaveBirthdayMessage,
  useSendBroadcast,
  type BroadcastAudience,
} from '../lib/queries'
import {
  Button,
  FieldError,
  Input,
  Label,
  SectionHeading,
  Textarea,
} from '../components/ui'

// ── Route definition ───────────────────────────────────────────────────────────

export const Route = createFileRoute('/super/notifications')({
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
  component: SuperNotificationsPage,
})

// ── Form schema ────────────────────────────────────────────────────────────────

const broadcastSchema = z.object({
  title: z
    .string()
    .min(1, { message: 'Escribe un título' })
    .max(60, { message: 'Máximo 60 caracteres — iOS lo corta' }),
  body: z
    .string()
    .min(1, { message: 'Escribe el mensaje' })
    .max(220, { message: 'Máximo 220 caracteres' }),
})

type FormValues = z.infer<typeof broadcastSchema>

const AUDIENCES: Array<{
  id: BroadcastAudience
  label: string
  hint: string
}> = [
  {
    id: 'all',
    label: 'Todos',
    hint: 'Cualquier usuario con la app y notificaciones activas',
  },
  {
    id: 'active',
    label: 'Clientes activos',
    hint: 'Pidieron en los últimos 8 días',
  },
  {
    id: 'lapsed',
    label: 'Inactivos (8+ días)',
    hint: 'Su último pedido tiene más de 8 días',
  },
]

// ── Page component ─────────────────────────────────────────────────────────────

function SuperNotificationsPage() {
  const [audience, setAudience] = useState<BroadcastAudience>('all')
  const { data: preview } = useBroadcastPreview(audience)
  const send = useSendBroadcast()
  const [lastResult, setLastResult] = useState<{
    users: number
    accepted: number
  } | null>(null)

  const { register, handleSubmit, formState, watch, reset } =
    useForm<FormValues>({
      resolver: zodResolver(broadcastSchema),
      defaultValues: { title: '', body: '' },
    })

  const titleValue = watch('title')
  const bodyValue = watch('body')

  const onSubmit = handleSubmit(async (values) => {
    const reach = preview?.users ?? 0
    const ok = window.confirm(
      `Vas a enviar esta notificación a ${reach} usuario(s) (${
        AUDIENCES.find((a) => a.id === audience)?.label
      }). ¿Confirmas?`,
    )
    if (!ok) return
    setLastResult(null)
    const result = await send.mutateAsync({ ...values, audience })
    setLastResult(result)
    reset()
  })

  return (
    <div className="page-rise mx-auto max-w-3xl px-6 py-12">
      <SectionHeading
        eyebrow="Panel · Notificaciones"
        title="Notificar."
        subtitle="Envía una notificación push a tus clientes. Úsala con criterio: demasiadas y la gente las apaga — y con ellas, el seguimiento de pedidos."
      />

      <form onSubmit={onSubmit} className="mt-10 space-y-8">
        {/* Audiencia */}
        <div>
          <Label>Audiencia</Label>
          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            {AUDIENCES.map((a) => {
              const selected = audience === a.id
              return (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => setAudience(a.id)}
                  className={`border p-4 text-left transition ${
                    selected
                      ? 'border-ink bg-ink text-paper'
                      : 'border-ink/15 bg-transparent hover:border-ink/40'
                  }`}
                >
                  <span className="block text-sm font-semibold">{a.label}</span>
                  <span
                    className={`mt-1 block text-xs ${
                      selected ? 'text-paper/70' : 'text-ink-muted'
                    }`}
                  >
                    {a.hint}
                  </span>
                </button>
              )
            })}
          </div>
          <p className="mt-2 text-xs text-ink-muted">
            Alcance actual:{' '}
            {preview
              ? `${preview.users} usuario(s) · ${preview.devices} dispositivo(s)`
              : 'calculando…'}
          </p>
        </div>

        {/* Título */}
        <div>
          <Label htmlFor="title">
            Título · {titleValue?.length ?? 0}/60
          </Label>
          <Input
            id="title"
            placeholder="Ej: 2x1 en botellones de agua 💧"
            {...register('title')}
          />
          <FieldError message={formState.errors.title?.message} />
        </div>

        {/* Mensaje */}
        <div>
          <Label htmlFor="body">
            Mensaje · {bodyValue?.length ?? 0}/220
          </Label>
          <Textarea
            id="body"
            rows={3}
            placeholder="Ej: El segundo botellón va gratis en tu próxima orden 💧 Pedí en la app"
            {...register('body')}
          />
          <FieldError message={formState.errors.body?.message} />
        </div>

        {/* Vista previa */}
        {(titleValue || bodyValue) && (
          <div className="border border-ink/15 bg-paper-deep/40 p-4">
            <span className="eyebrow">Vista previa</span>
            <p className="mt-2 text-sm font-semibold text-ink">
              {titleValue || 'Título'}
            </p>
            <p className="mt-0.5 text-sm text-ink-soft">
              {bodyValue || 'Mensaje'}
            </p>
          </div>
        )}

        <Button
          type="submit"
          disabled={send.isPending || (preview?.users ?? 0) === 0}
        >
          {send.isPending
            ? 'Enviando…'
            : `Enviar a ${preview?.users ?? 0} usuario(s) →`}
        </Button>

        {(preview?.users ?? 0) === 0 && (
          <p className="text-xs text-ink-muted">
            Nadie puede recibirla todavía — los dispositivos se registran
            cuando los clientes instalan la versión 1.0.2+ y aceptan
            notificaciones.
          </p>
        )}

        {send.isError && (
          <p className="text-sm text-bad">
            No se pudo enviar. Intenta de nuevo.
          </p>
        )}
        {lastResult && (
          <p className="text-sm text-ok">
            Enviada ✓ — {lastResult.accepted} notificación(es) aceptada(s) para{' '}
            {lastResult.users} usuario(s).
          </p>
        )}
      </form>

      <BirthdayMessageSection />
    </div>
  )
}

// ── Birthday greeting config ───────────────────────────────────────────────────
//
// The daily 09:00 cron greets every customer whose birthday is today with this
// copy. `{nombre}` is replaced with the customer's first name at send time.

function BirthdayMessageSection() {
  const { data: saved, isPending } = useBirthdayMessage()
  const save = useSaveBirthdayMessage()
  const [title, setTitle] = useState<string | null>(null)
  const [body, setBody] = useState<string | null>(null)
  const [savedFlash, setSavedFlash] = useState(false)

  if (isPending || !saved) {
    return (
      <div className="mt-16 border-t border-ink/10 pt-10">
        <span className="eyebrow">Cargando mensaje de cumpleaños…</span>
      </div>
    )
  }

  const titleValue = title ?? saved.title
  const bodyValue = body ?? saved.body
  const dirty = titleValue !== saved.title || bodyValue !== saved.body
  const previewName = 'Ana'

  const onSave = async () => {
    if (!titleValue.trim() || !bodyValue.trim()) return
    await save.mutateAsync({ title: titleValue.trim(), body: bodyValue.trim() })
    setTitle(null)
    setBody(null)
    setSavedFlash(true)
    setTimeout(() => setSavedFlash(false), 3000)
  }

  return (
    <div className="mt-16 border-t border-ink/10 pt-10">
      <SectionHeading
        eyebrow="Automático · Diario 9:00"
        title="Mensaje de cumpleaños."
        subtitle="Cada cliente recibe este push el día de su cumpleaños, solo. Usa {nombre} donde quieras su nombre."
      />

      <div className="mt-8 space-y-6">
        <div>
          <Label htmlFor="bdayTitle">Título · {titleValue.length}/60</Label>
          <Input
            id="bdayTitle"
            value={titleValue}
            maxLength={60}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="bdayBody">Mensaje · {bodyValue.length}/220</Label>
          <Textarea
            id="bdayBody"
            rows={3}
            value={bodyValue}
            maxLength={220}
            onChange={(e) => setBody(e.target.value)}
          />
        </div>

        <div className="border border-ink/15 bg-paper-deep/40 p-4">
          <span className="eyebrow">Así lo recibe {previewName}</span>
          <p className="mt-2 text-sm font-semibold text-ink">
            {titleValue.replaceAll('{nombre}', previewName) || 'Título'}
          </p>
          <p className="mt-0.5 text-sm text-ink-soft">
            {bodyValue.replaceAll('{nombre}', previewName) || 'Mensaje'}
          </p>
        </div>

        <div className="flex items-center gap-4">
          <Button
            onClick={onSave}
            disabled={save.isPending || !dirty || !titleValue.trim() || !bodyValue.trim()}
          >
            {save.isPending ? 'Guardando…' : 'Guardar mensaje'}
          </Button>
          {savedFlash && <span className="text-sm text-ok">Guardado ✓</span>}
          {save.isError && (
            <span className="text-sm text-bad">No se pudo guardar.</span>
          )}
        </div>
      </div>
    </div>
  )
}
