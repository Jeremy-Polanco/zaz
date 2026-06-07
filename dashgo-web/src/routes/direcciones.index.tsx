import { createFileRoute, Link } from '@tanstack/react-router'
import { Button, SectionHeading } from '../components/ui'
import { useMyAddresses } from '../lib/queries'

export const Route = createFileRoute('/direcciones/')({
  component: AddressesPage,
})

export function AddressesPage() {
  const { data: addresses, isPending } = useMyAddresses()

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
        subtitle="Dónde te llevamos los pedidos."
        action={
          <Link to="/direcciones/nueva">
            <Button variant="accent">+ Agregar dirección</Button>
          </Link>
        }
      />

      {list.length > 0 ? (
        <ul className="flex flex-col gap-3">
          {list.map((a) => (
            <li key={a.id}>
              <Link
                to="/direcciones/$id"
                params={{ id: a.id }}
                className="flex items-center justify-between gap-4 border border-ink/15 bg-paper p-4 transition-colors hover:border-ink/40"
              >
                <div className="min-w-0">
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
                </div>
                <span aria-hidden="true" className="text-ink-muted">
                  →
                </span>
              </Link>
            </li>
          ))}
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
    </div>
  )
}
