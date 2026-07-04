import { createFileRoute, Link } from '@tanstack/react-router'

export const Route = createFileRoute('/soporte')({
  component: Support,
})

const LEGAL_NAME = 'Urban Dash LLC'
const CONTACT_EMAIL = 'urban@dashgo.dev'
const PHYSICAL_ADDRESS = '45 Cypress Ave, Bogota, NJ 07603'

function Support() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <div className="mb-8 flex flex-col gap-2">
        <span className="eyebrow">Ayuda</span>
        <h1 className="display text-4xl font-semibold text-ink">Soporte</h1>
        <p className="text-sm text-ink-muted">
          ¿Necesitás ayuda con Udash? Escribinos y te respondemos.
        </p>
      </div>

      <section className="mb-8 rounded-md border border-ink/10 bg-paper-soft p-5">
        <h2 className="mb-2 text-lg font-semibold text-ink">Contactanos</h2>
        <p className="text-sm text-ink">
          La forma más rápida de resolver cualquier duda es por email. Te
          respondemos dentro de las 24 horas hábiles.
        </p>
        <p className="mt-3 text-sm text-ink">
          Email:{' '}
          <a href={`mailto:${CONTACT_EMAIL}`} className="text-brand underline">
            {CONTACT_EMAIL}
          </a>
        </p>
      </section>

      <Section title="Preguntas frecuentes">
        <ul className="list-disc space-y-3 pl-5">
          <li>
            <strong>¿Cómo hago un pedido?</strong> Elegí tus productos del
            catálogo, tocá &quot;Agregar&quot; y poné la cantidad, y confirmá en
            el checkout. Podés pagar al recibir (efectivo) o con tarjeta.
          </li>
          <li>
            <strong>¿Cómo sigo mi pedido?</strong> En la pantalla del pedido vas
            a ver el estado en tres pasos: Pagar → Pendiente → Entregado.
          </li>
          <li>
            <strong>¿Cómo pago?</strong> Podés pagar en efectivo al recibir tu
            pedido, o con tarjeta de forma segura a través de Stripe. Nosotros no
            guardamos los datos de tu tarjeta.
          </li>
          <li>
            <strong>¿Cómo alquilo un bebedero?</strong> Buscá el bebedero en el
            catálogo y agregalo a tu pedido. El cargo mensual se aplica
            automáticamente a partir del segundo mes.
          </li>
          <li>
            <strong>¿Cómo cancelo un pedido?</strong> Si tu pedido todavía no
            salió a entregar, escribinos a {CONTACT_EMAIL} y lo cancelamos.
          </li>
          <li>
            <strong>¿Cómo borro mi cuenta?</strong> Desde la app, en Perfil →
            Borrar cuenta. También podés pedirlo escribiéndonos a {CONTACT_EMAIL}.
          </li>
        </ul>
      </Section>

      <Section title="Datos de la empresa">
        <div className="rounded-md border border-ink/10 bg-paper-soft p-4 text-sm">
          <p>
            <strong>{LEGAL_NAME}</strong>
          </p>
          <p>{PHYSICAL_ADDRESS}</p>
          <p>
            Email:{' '}
            <a href={`mailto:${CONTACT_EMAIL}`} className="text-brand underline">
              {CONTACT_EMAIL}
            </a>
          </p>
        </div>
      </Section>

      <div className="mt-10 border-t border-ink/10 pt-6 text-center">
        <Link to="/" className="text-sm text-ink-muted underline">
          Volver al inicio
        </Link>
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="mb-3 text-xl font-semibold text-ink">{title}</h2>
      <div className="space-y-2 text-ink">{children}</div>
    </section>
  )
}
