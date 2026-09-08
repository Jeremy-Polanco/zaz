import { useEffect, useRef, useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { usePromoterByCode } from '../lib/queries'

export const Route = createFileRoute('/r/$code')({
  component: ReferralLandingRoute,
})

function ReferralLandingRoute() {
  const { code } = Route.useParams()
  return <ReferralLanding code={code} />
}

// Exported for tests: the landing renders for real, the route wrapper only
// feeds it the URL param.
export function ReferralLanding({ code }: { code: string }) {
  const { data, isPending, isError } = usePromoterByCode(code)
  const upper = code.toUpperCase()

  return (
    <div className="page-rise mx-auto flex min-h-[calc(100vh-10rem)] max-w-3xl flex-col items-center justify-center px-6 py-20 text-center">
      <span className="eyebrow mb-4">Invitación</span>

      {isPending ? (
        <p className="text-sm text-ink-muted">Cargando…</p>
      ) : isError || !data ? (
        <>
          <h1 className="display text-4xl font-semibold leading-[1.05] text-ink sm:text-5xl">
            Código <span className="italic text-bad">no válido.</span>
          </h1>
          <p className="mt-6 max-w-md text-base text-ink-muted">
            Revisá el link que te mandaron. Si sigue sin funcionar, pedile al
            promotor que te reenvíe el código correcto.
          </p>
          <Link to="/login" search={{ next: undefined, ref: undefined }} className="mt-10">
            <button className="inline-flex h-12 items-center justify-center rounded-xs border border-ink bg-ink px-6 font-medium uppercase tracking-[0.08em] text-paper hover:bg-ink-soft">
              Entrar a Udash
            </button>
          </Link>
        </>
      ) : (
        <>
          <h1 className="display text-4xl font-semibold leading-[1.05] text-ink sm:text-5xl">
            Te invitó{' '}
            <span className="italic text-brand">{data.fullName}</span>{' '}
            <span role="img" aria-label="celebración">
              🎉
            </span>
          </h1>
          <p className="mt-6 max-w-md text-base text-ink-muted">
            Bajate la app, poné este código al entrar y súmate a Udash — tu
            colmado al timbre.
          </p>

          <CodeCard code={upper} />

          {/* /app is a user-agent redirect in vercel.json (Play / App Store /
              fallback), NOT a router route — it must stay a plain anchor. */}
          <a
            href="/app"
            className="mt-10 inline-flex h-14 items-center justify-center rounded-xs border border-accent bg-accent px-8 font-medium uppercase tracking-[0.08em] text-brand-dark transition-all duration-200 hover:bg-accent-dark hover:-translate-y-px"
          >
            Descargar la app →
          </a>
          <p className="mt-4 max-w-sm text-xs text-ink-muted">
            Al abrir la app, tocá «Tengo un código de promotor» y pegá{' '}
            <span className="nums font-medium text-ink">{upper}</span>.
          </p>

          <Link
            to="/login"
            search={{ ref: upper, next: undefined }}
            className="mt-8 inline-flex h-12 items-center justify-center rounded-xs border border-ink px-6 text-sm font-medium uppercase tracking-[0.08em] text-ink transition-colors hover:bg-ink hover:text-paper"
          >
            Seguir en la web →
          </Link>
        </>
      )}
    </div>
  )
}

function CodeCard({ code }: { code: string }) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )

  const onCopy = () => {
    // jsdom, http:// origins and older in-app browsers have no clipboard API.
    const clipboard = navigator.clipboard
    if (!clipboard?.writeText) return
    void Promise.resolve(clipboard.writeText(code))
      .then(() => {
        setCopied(true)
        if (timer.current) clearTimeout(timer.current)
        timer.current = setTimeout(() => setCopied(false), 2000)
      })
      .catch(() => undefined)
  }

  return (
    <div className="mt-10 flex flex-col items-center gap-3 border border-ink/15 bg-paper-elev px-8 py-6">
      <span className="text-[0.7rem] uppercase tracking-[0.24em] text-ink-muted">
        Tu código
      </span>
      <p className="nums display text-3xl font-semibold tracking-[0.3em] text-ink sm:text-4xl">
        {code}
      </p>
      <button
        type="button"
        onClick={onCopy}
        className="inline-flex h-9 items-center justify-center rounded-xs border border-ink/40 px-4 text-[0.72rem] font-medium uppercase tracking-[0.18em] text-ink transition-colors hover:bg-ink hover:text-paper"
      >
        {copied ? 'Copiado ✓' : 'Copiar código'}
      </button>
    </div>
  )
}
