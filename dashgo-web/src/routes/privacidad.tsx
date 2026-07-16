import { createFileRoute, Link } from '@tanstack/react-router'

export const Route = createFileRoute('/privacidad')({
  component: PrivacyPolicy,
})

const LAST_UPDATED = '1 de junio de 2026'
const LEGAL_NAME = 'UrbanDash LLC'
const CONTACT_EMAIL = 'urban@dashgo.dev'
const PHYSICAL_ADDRESS = '45 Cypress Ave, Bogota, NJ 07603'

function PrivacyPolicy() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <div className="mb-8 flex flex-col gap-2">
        <span className="eyebrow">Legal</span>
        <h1 className="display text-4xl font-semibold text-ink">
          Política de Privacidad
        </h1>
        <p className="text-sm text-ink-muted">
          Última actualización: {LAST_UPDATED}
        </p>
      </div>

      <section className="mb-8 rounded-md border border-ink/10 bg-paper-soft p-5">
        <h2 className="mb-2 text-lg font-semibold text-ink">Resumen rápido</h2>
        <ul className="list-disc space-y-1 pl-5 text-sm text-ink">
          <li>Usamos tu teléfono para iniciar sesión y tu dirección para entregar.</li>
          <li>Tus pagos los procesa Stripe directamente — nosotros no guardamos tu tarjeta.</li>
          <li>No vendemos tus datos. No los usamos para publicidad.</li>
          <li>Podés pedir borrar tu cuenta cuando quieras.</li>
        </ul>
      </section>

      <Section title="1. Quiénes somos">
        <p>
          Udash es operada por {LEGAL_NAME} (&quot;Udash&quot;, &quot;nosotros&quot;).
          Esta política explica qué datos recolectamos cuando usás la app Udash o
          el sitio web, cómo los usamos, con quién los compartimos y qué derechos
          tenés sobre ellos.
        </p>
      </Section>

      <Section title="2. Qué datos recolectamos">
        <p className="mb-3">
          Solo recolectamos lo que necesitamos para que la app funcione:
        </p>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <strong>Número de teléfono</strong> — para enviarte el código de
            verificación por WhatsApp y dejar que inicies sesión.
          </li>
          <li>
            <strong>Nombre</strong> — para identificarte al recibir tu pedido.
          </li>
          <li>
            <strong>Dirección de entrega</strong> — para llevar tu pedido al
            lugar correcto. Podés tener varias guardadas.
          </li>
          <li>
            <strong>Ubicación precisa (GPS)</strong> — opcional, solo si la
            autorizás. La usamos en checkout para seleccionar automáticamente la
            dirección guardada más cercana a donde estás. No guardamos un
            historial de tus ubicaciones GPS.
          </li>
          <li>
            <strong>Historial de pedidos</strong> — qué pediste, cuándo, a qué
            dirección y el total. Necesario para mostrarte tu historial y para
            facturación.
          </li>
          <li>
            <strong>Identificador interno de usuario</strong> — un ID único que
            generamos para vincular tu cuenta con tus pedidos.
          </li>
          <li>
            <strong>Datos de fallos y rendimiento</strong> — si la app crashea o
            va lenta, recibimos reportes técnicos (rastro del error, modelo del
            dispositivo, versión del sistema). Estos reportes no incluyen tu
            identidad.
          </li>
        </ul>
        <p className="mt-3">
          <strong>Lo que NO recolectamos:</strong> tu correo (a menos que vos lo
          ingreses opcionalmente), tu identificador publicitario del dispositivo,
          tu historial de navegación, tu lista de contactos, fotos, micrófono ni
          calendario.
        </p>
      </Section>

      <Section title="3. Cómo usamos tus datos">
        <ul className="list-disc space-y-2 pl-5">
          <li>Verificar tu identidad y mantener tu sesión segura.</li>
          <li>Procesar y entregar tus pedidos.</li>
          <li>Cobrarte mediante Stripe.</li>
          <li>Mostrarte tu historial de pedidos y facturación.</li>
          <li>Notificarte sobre el estado de tu pedido.</li>
          <li>Detectar fraude y prevenir abuso del servicio.</li>
          <li>Mejorar la app a partir de reportes de fallos y rendimiento.</li>
          <li>Cumplir con obligaciones legales (impuestos, facturación).</li>
        </ul>
      </Section>

      <Section title="4. Con quién compartimos tus datos">
        <p className="mb-3">
          Compartimos lo mínimo necesario con proveedores de servicios que nos
          ayudan a operar:
        </p>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <strong>Stripe</strong> (procesamiento de pagos) — recibe los datos
            de tu tarjeta directamente. Nosotros no guardamos tu número de
            tarjeta. Política:{' '}
            <a
              href="https://stripe.com/privacy"
              className="text-brand underline"
              target="_blank"
              rel="noopener noreferrer"
            >
              stripe.com/privacy
            </a>
            .
          </li>
          <li>
            <strong>Meta (WhatsApp)</strong> (mensajería) — entrega los códigos
            de verificación por WhatsApp a través de la WhatsApp Cloud API.
            Recibe tu número de teléfono. Política:{' '}
            <a
              href="https://www.whatsapp.com/legal/business-policy/"
              className="text-brand underline"
              target="_blank"
              rel="noopener noreferrer"
            >
              whatsapp.com/legal/business-policy
            </a>
            .
          </li>
          <li>
            <strong>Twilio</strong> (mensajería SMS) — entrega las
            notificaciones de pedido por SMS. Recibe tu número de teléfono.
            Política:{' '}
            <a
              href="https://www.twilio.com/legal/privacy"
              className="text-brand underline"
              target="_blank"
              rel="noopener noreferrer"
            >
              twilio.com/legal/privacy
            </a>
            .
          </li>
          <li>
            <strong>Sentry</strong> (reportes de fallos) — recibe los rastros
            técnicos cuando la app crashea o va lenta. Política:{' '}
            <a
              href="https://sentry.io/privacy/"
              className="text-brand underline"
              target="_blank"
              rel="noopener noreferrer"
            >
              sentry.io/privacy
            </a>
            .
          </li>
          <li>
            <strong>Proveedor de infraestructura</strong> (Digital Ocean / AWS o
            equivalente) — aloja la base de datos y los servidores donde se
            guardan tus pedidos.
          </li>
          <li>
            <strong>Apple y Google</strong> — distribuyen la app a través de App
            Store y Google Play.
          </li>
          <li>
            <strong>El colmado o repartidor que recibe tu pedido</strong> — para
            poder entregarlo, ve tu nombre, teléfono y dirección.
          </li>
        </ul>
        <p className="mt-3">
          <strong>No vendemos tus datos a terceros.</strong> No los compartimos
          para publicidad. No los usamos para perfilarte fuera de la app.
        </p>
      </Section>

      <Section title="5. Cuánto tiempo guardamos tus datos">
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <strong>Tu cuenta</strong> — mientras la tengas activa. Si pedís
            borrarla, eliminamos tu nombre, teléfono y direcciones dentro de los
            30 días.
          </li>
          <li>
            <strong>Tu historial de pedidos</strong> — guardado hasta 7 años por
            obligación fiscal y contable, incluso después de borrar la cuenta.
            En ese caso queda disociado de tu identidad cuando es legalmente
            posible.
          </li>
          <li>
            <strong>Reportes de fallos</strong> — Sentry los retiene por 90
            días.
          </li>
          <li>
            <strong>Códigos de verificación de WhatsApp</strong> — vencen a los
            5 minutos. No los guardamos en texto plano.
          </li>
        </ul>
      </Section>

      <Section title="6. Tus derechos">
        <p className="mb-3">Podés en cualquier momento:</p>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <strong>Acceder</strong> a los datos que tenemos sobre vos.
          </li>
          <li>
            <strong>Corregir</strong> tu nombre o direcciones desde la app.
          </li>
          <li>
            <strong>Borrar tu cuenta</strong> — desde la app (Perfil → Borrar
            cuenta) o escribiéndonos a {CONTACT_EMAIL}.
          </li>
          <li>
            <strong>Pedir una copia</strong> de tus datos en formato portátil.
          </li>
          <li>
            <strong>Oponerte</strong> al procesamiento por motivos legítimos.
          </li>
          <li>
            <strong>Revocar permisos del dispositivo</strong> (ubicación) desde
            la configuración del sistema operativo.
          </li>
        </ul>
        <p className="mt-3">
          Si vivís en California, Nueva York u otra jurisdicción con leyes
          locales de privacidad, también tenés los derechos específicos que esas
          leyes te otorguen — los respetamos en igualdad de términos.
        </p>
      </Section>

      <Section title="7. Niños menores de 13 años">
        <p>
          Udash no está dirigido a menores de 13 años. No recolectamos
          conscientemente datos de menores de 13. Si descubrimos que recolectamos
          datos de un menor sin consentimiento parental, los borramos. Si sos
          padre o tutor y creés que tu hijo nos dio datos, escribinos a{' '}
          {CONTACT_EMAIL}.
        </p>
      </Section>

      <Section title="8. Seguridad">
        <p>
          Usamos cifrado en tránsito (HTTPS / TLS) para todas las comunicaciones,
          contraseñas hasheadas con bcrypt para los códigos de verificación, y
          control de acceso basado en roles en el servidor. Stripe maneja los
          datos de tarjeta bajo el estándar PCI-DSS Nivel 1. Sin embargo, ningún
          sistema es 100% seguro — si sospechás un acceso no autorizado a tu
          cuenta, escribinos de inmediato.
        </p>
      </Section>

      <Section title="9. Transferencias internacionales">
        <p>
          Udash opera principalmente en los Estados Unidos. Nuestros servidores
          están alojados en EE.UU. Si nos escribís desde fuera del país, tus
          datos pueden ser procesados en EE.UU. bajo nuestras protecciones
          estándar.
        </p>
      </Section>

      <Section title="10. Cambios a esta política">
        <p>
          Si cambiamos esta política de forma significativa, te avisamos por la
          app o por WhatsApp antes de que el cambio entre en efecto. La fecha de
          arriba (&quot;Última actualización&quot;) refleja la versión vigente.
        </p>
      </Section>

      <Section title="11. Contacto">
        <p className="mb-3">
          Para cualquier pedido relacionado con tus datos, escribinos a:
        </p>
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
