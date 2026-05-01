import { createFileRoute, Link } from '@tanstack/react-router'
import { usePromoterByCode } from '../lib/queries'

export const Route = createFileRoute('/r/$code')({
  component: ReferralLanding,
})

function ReferralLanding() {
  const { code } = Route.useParams()
  const { data, isPending, isError } = usePromoterByCode(code)

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
              Entrar a Zaz
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
            Creá tu cuenta usando este código y súmate a Zaz — tu colmado
            al timbre.
          </p>
          <p className="mt-8 nums text-sm uppercase tracking-[0.3em] text-ink">
            Código:{' '}
            <span className="text-brand">{code.toUpperCase()}</span>
          </p>
          <Link
            to="/login"
            search={{ ref: code.toUpperCase(), next: undefined }}
            className="mt-10"
          >
            <button className="inline-flex h-14 items-center justify-center rounded-xs border border-accent bg-accent px-8 font-medium uppercase tracking-[0.08em] text-brand-dark hover:bg-accent-dark">
              Crear cuenta con este código →
            </button>
          </Link>
        </>
      )}
    </div>
  )
}
