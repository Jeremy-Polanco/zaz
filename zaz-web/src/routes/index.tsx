import { createFileRoute, isRedirect, Link, redirect } from '@tanstack/react-router'
import { TOKEN_KEY } from '../lib/api'
import { api } from '../lib/api'
import type { AuthUser } from '../lib/types'
import { Button } from '../components/ui'

export const Route = createFileRoute('/')({
  beforeLoad: async () => {
    const token = localStorage.getItem(TOKEN_KEY)
    if (!token) return
    try {
      const { data } = await api.get<AuthUser>('/auth/me')
      if (data.role === 'super_admin_delivery') throw redirect({ to: '/super/orders' })
      if (data.role === 'promoter') throw redirect({ to: '/catalog' })
      throw redirect({ to: '/home' })
    } catch (e) {
      if (isRedirect(e)) throw e
      localStorage.removeItem(TOKEN_KEY)
    }
  },
  component: Landing,
})

const MARQUEE_ITEMS = [
  'Galón Planeta Azul',
  '5 galones',
  'Botellón',
  'El colmado del barrio',
  'Entrega al timbre',
  'Pago al repartidor',
  'Washington Heights',
  'Inwood',
  'Bronx',
  'Queens',
  'Brooklyn',
]

function Marquee() {
  const items = [...MARQUEE_ITEMS, ...MARQUEE_ITEMS]
  return (
    <div className="relative overflow-hidden border-y border-ink/15 bg-ink text-paper py-4">
      <div className="marquee-track flex whitespace-nowrap">
        {items.map((it, i) => (
          <span
            key={i}
            className="mx-8 flex items-center gap-8 text-[0.72rem] uppercase tracking-[0.24em]"
          >
            {it}
            <span className="text-brand">✦</span>
          </span>
        ))}
      </div>
    </div>
  )
}

function Landing() {
  return (
    <div className="page-rise">
      {/* HERO */}
      <section className="relative overflow-hidden">
        <div className="mx-auto grid max-w-7xl grid-cols-1 gap-10 px-6 py-16 md:grid-cols-12 md:py-24">
          <div className="md:col-span-7 flex flex-col justify-center gap-8">
            <div className="flex items-center gap-3">
              <span className="h-px w-10 bg-ink" />
              <span className="eyebrow">Nº 001 — New York, {new Date().getFullYear()}</span>
            </div>

            <h1 className="display text-[3.5rem] font-semibold leading-[0.95] tracking-[-0.035em] text-ink sm:text-[5rem] md:text-[6.5rem]">
              El colmado
              <br />
              del barrio,
              <br />
              <span className="italic text-brand">al timbre.</span>
            </h1>

            <p className="max-w-lg text-lg leading-relaxed text-ink-soft">
              Agua de la bodega de confianza, entregada en minutos. Elige tu colmado,
              pide tu galón y paga al repartidor — como se hace desde siempre,
              pero ahora lo hazs desde el teléfono.
            </p>

            <div className="flex flex-wrap items-center gap-4">
              <Link to="/login" search={{ next: undefined, ref: undefined }}>
                <Button size="lg" variant="accent">
                  Pedir agua ahora
                </Button>
              </Link>
              <Link to="/login" search={{ next: undefined, ref: undefined }}>
                <Button size="lg" variant="secondary">
                  Ya tengo cuenta
                </Button>
              </Link>
            </div>

            <div className="mt-6 grid grid-cols-3 gap-6 border-t border-ink/15 pt-6">
              <Stat value="12min" label="Tiempo promedio" />
              <Stat value="$0" label="Costo de envío" />
              <Stat value="24/7" label="Disponible" />
            </div>
          </div>

          {/* Right — the "poster" */}
          <div className="md:col-span-5 relative">
            <HeroPoster />
          </div>
        </div>
      </section>

      <Marquee />

      {/* HOW IT WORKS */}
      <section className="mx-auto max-w-7xl px-6 py-20">
        <div className="mb-12 flex flex-col gap-2">
          <span className="eyebrow">Cómo funciona</span>
          <h2 className="display max-w-2xl text-4xl font-semibold leading-tight sm:text-5xl">
            Tres pasos.
            <br />
            <span className="text-ink-muted">Ninguna fricción.</span>
          </h2>
        </div>

        <div className="grid grid-cols-1 gap-px bg-ink/10 md:grid-cols-3">
          <Step
            n="01"
            title="Elige tu colmado"
            copy="Buscá tu bodega de confianza en el listado. Cada colmado tiene su propio catálogo y precios."
          />
          <Step
            n="02"
            title="Armá tu pedido"
            copy="Galón, botellón, múltiples unidades. Sumá lo que te haga falta y dejá tu dirección."
          />
          <Step
            n="03"
            title="Recibís y pagas"
            copy="Nuestro repartidor lleva tu pedido a casa. Pagas en efectivo al entregar."
          />
        </div>
      </section>

      {/* ROLES */}
      <section className="border-t border-ink/10 bg-paper-deep/40">
        <div className="mx-auto grid max-w-7xl grid-cols-1 gap-10 px-6 py-20 md:grid-cols-2">
          <div>
            <span className="eyebrow">Para tu colmado</span>
            <h2 className="display mt-3 text-4xl font-semibold leading-tight sm:text-5xl">
              ¿Tienes un colmado?
              <br />
              <span className="italic text-brand">Súmate.</span>
            </h2>
            <p className="mt-4 max-w-md text-base text-ink-soft">
              Convertí cada galón en una venta digital. Vos controlas el catálogo,
              los precios, el stock y la disponibilidad. Nosotros nos encargamos
              de la entrega.
            </p>
            <div className="mt-6">
              <Link to="/login" search={{ next: undefined, ref: undefined }}>
                <Button variant="primary">Registrá tu colmado</Button>
              </Link>
            </div>
          </div>

          <div className="relative flex items-center justify-center rounded-sm border border-ink/15 bg-paper p-10">
            <div className="absolute left-4 top-4 eyebrow">EST. 2026</div>
            <div className="text-center">
              <div className="display text-[8rem] font-bold leading-none text-brand">
                H₂O
              </div>
              <div className="eyebrow mt-4">
                Multi-tenant · Multi-barrio
              </div>
            </div>
            <div className="absolute bottom-4 right-4 eyebrow">NYC/RD</div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-ink/10">
        <div className="mx-auto max-w-7xl px-6 py-20 text-center">
          <span className="eyebrow">Últimas palabras</span>
          <h2 className="display mt-4 text-5xl font-semibold leading-[0.95] sm:text-7xl">
            No dejes que
            <br />
            se te <span className="italic text-brand">acabe.</span>
          </h2>
          <div className="mt-8 flex flex-wrap justify-center gap-4">
            <Link to="/login" search={{ next: undefined, ref: undefined }}>
              <Button size="lg" variant="accent">
                Crear mi cuenta
              </Button>
            </Link>
            <Link to="/login" search={{ next: undefined, ref: undefined }}>
              <Button size="lg" variant="ghost">
                Iniciar sesión →
              </Button>
            </Link>
          </div>
        </div>
      </section>
    </div>
  )
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="display text-3xl font-semibold text-ink nums">{value}</span>
      <span className="eyebrow">{label}</span>
    </div>
  )
}

function Step({ n, title, copy }: { n: string; title: string; copy: string }) {
  return (
    <div className="group relative flex flex-col gap-6 bg-paper p-8 transition-colors hover:bg-paper-deep/60">
      <div className="flex items-start justify-between">
        <span className="nums text-[0.7rem] font-medium uppercase tracking-[0.2em] text-ink-muted">
          {n}
        </span>
        <span className="h-2 w-2 rounded-full bg-accent opacity-0 transition-opacity group-hover:opacity-100" />
      </div>
      <h3 className="display text-3xl font-semibold leading-tight text-ink">
        {title}
      </h3>
      <p className="text-base leading-relaxed text-ink-soft">{copy}</p>
    </div>
  )
}

function HeroPoster() {
  return (
    <div className="relative aspect-[4/5] overflow-hidden rounded-sm border border-ink bg-brand">
      {/* layered circles — water ripple abstract */}
      <div className="absolute inset-0 opacity-40">
        <div className="absolute left-1/2 top-1/2 h-[140%] w-[140%] -translate-x-1/2 -translate-y-1/2 rounded-full border border-paper/30" />
        <div className="absolute left-1/2 top-1/2 h-[110%] w-[110%] -translate-x-1/2 -translate-y-1/2 rounded-full border border-paper/30" />
        <div className="absolute left-1/2 top-1/2 h-[80%] w-[80%] -translate-x-1/2 -translate-y-1/2 rounded-full border border-paper/30" />
        <div className="absolute left-1/2 top-1/2 h-[50%] w-[50%] -translate-x-1/2 -translate-y-1/2 rounded-full border border-paper/30" />
      </div>

      {/* big glyph */}
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-paper">
        <span className="text-[0.7rem] uppercase tracking-[0.3em] opacity-80">
          Vol. 01 · Galón
        </span>
        <span className="display text-[12rem] font-bold leading-[0.75] text-paper">
          5
        </span>
        <span className="text-[0.7rem] uppercase tracking-[0.3em] opacity-80">
          Gal · Planeta Azul
        </span>
      </div>

      {/* corner tags */}
      <div className="absolute left-4 top-4 text-[0.65rem] uppercase tracking-[0.2em] text-paper/80">
        NYC
      </div>
      <div className="absolute right-4 top-4 text-[0.65rem] uppercase tracking-[0.2em] text-paper/80">
        24/7
      </div>
      <div className="absolute bottom-4 left-4 right-4 flex items-center justify-between text-[0.65rem] uppercase tracking-[0.2em] text-paper/80">
        <span>Zaz</span>
        <span>— Agua</span>
      </div>
    </div>
  )
}
