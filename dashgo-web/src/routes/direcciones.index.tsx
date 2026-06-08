import { createFileRoute, Link } from '@tanstack/react-router'
import { Button, SectionHeading } from '../components/ui'
import { useMyAddresses, useSetDefaultAddress } from '../lib/queries'

export const Route = createFileRoute('/direcciones/')({
  component: AddressesPage,
})

export function AddressesPage() {
  const { data: addresses, isPending } = useMyAddresses()
  const setDefault = useSetDefaultAddress()

  if (isPending) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-20 text-center">
        <span className="eyebrow">Cargando direcciones…</span>
      </div>
    )
  }

  const list = addresses ?? []

  return (
    <div className="page-rise mx-auto max-w-3xl px-6 py-12">
      <SectionHeading
        eyebrow="Mi cuenta"
        title={
          <>
            Mis <span className="italic text-brand">direcciones.</span>
          </>
        }
        subtitle="Elegí la principal de un toque, o agregá una nueva."
        action={
          <Link to="/direcciones/nueva">
            <Button variant="accent">+ Agregar dirección</Button>
          </Link>
        }
      />

      {list.length > 0 ? (
        <ul className="flex flex-col gap-3">
          {list.map((a) => {
            const settingThis = setDefault.isPending && setDefault.variables === a.id
            return (
              <li
                key={a.id}
                className={`flex items-center justify-between gap-4 border bg-paper p-4 transition-colors ${
                  a.isDefault ? 'border-ink' : 'border-ink/15 hover:border-ink/40'
                }`}
              >
                <Link
                  to="/direcciones/$id"
                  params={{ id: a.id }}
                  className="min-w-0 flex-1 transition-colors hover:text-brand"
                >
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-ink">{a.label}</span>
                    {a.isDefault && (
                      <span className="text-[0.62rem] uppercase tracking-[0.14em] text-brand">
                        Por defecto
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 truncate text-sm text-ink-soft">
                    {a.line1}
                    {a.line2 ? `, ${a.line2}` : ''}
                  </p>
                </Link>

                <div className="flex shrink-0 items-center gap-3">
                  {a.isDefault ? (
                    <span className="text-[0.62rem] uppercase tracking-[0.14em] text-ink-muted">
                      ✓ Activa
                    </span>
                  ) : (
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      onClick={() => setDefault.mutate(a.id)}
                      disabled={setDefault.isPending}
                      aria-label={`Hacer "${a.label}" principal`}
                    >
                      {settingThis ? 'Cambiando…' : 'Hacer principal'}
                    </Button>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      ) : (
        <div className="py-16 text-center">
          <span className="eyebrow">Sin direcciones guardadas</span>
          <p className="mt-3 text-ink-muted">
            Agregá una dirección para agilizar tus pedidos.
          </p>
          <Link to="/direcciones/nueva" className="mt-6 inline-block">
            <Button variant="accent" size="lg">
              + Agregar dirección
            </Button>
          </Link>
        </div>
      )}

      {setDefault.isError && (
        <p className="mt-4 border-l-2 border-bad pl-3 text-sm font-medium text-bad">
          No pudimos cambiar tu dirección principal. Intentá de nuevo.
        </p>
      )}
    </div>
  )
}
