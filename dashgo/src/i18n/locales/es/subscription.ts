export default {
  eyebrow: 'Mi plan',
  title: {
    lead: 'Mi',
    accent: 'suscripción.',
  },
  // Copy canónico también exportado como SUBSCRIPTION_PERKS en
  // src/app/(tabs)/subscription.tsx (web↔mobile parity) — mantener idénticos.
  perks: 'Bebedero gratis, envío gratis y mantenimiento sin costo.',
  toast: {
    activated: '¡Suscripción activada! {{perks}}',
  },
  redirecting: 'Redirigiendo…',
  managePortal: 'Gestionar suscripción',
  none: {
    pricePerMonth: '{{price}} / mes',
    details: 'Impuestos incluidos · {{perks}} Cancela cuando quieras.',
    subscribe: 'Suscribirme',
  },
  active: {
    badge: 'Activa',
    renewsOn: 'Suscripto al plan · Renueva el {{date}}',
    canceling: 'Cancelando…',
    cancel: 'Cancelar',
  },
  cancelPending: {
    title: 'Activo hasta {{date}}, no se renovará.',
    body: 'Aún tienes envío gratis y mantenimiento sin costo hasta esa fecha.',
    reactivating: 'Reactivando…',
    reactivate: 'Reactivar',
  },
  pastDue: {
    title: 'Tu pago está pendiente.',
    body: 'Actualizá tu medio de pago para seguir con el envío gratis y el mantenimiento sin costo.',
  },
  canceled: {
    title: 'Tu suscripción terminó.',
    resubscribe: 'Suscribirme de nuevo',
  },
  inactive: {
    title: 'Tu suscripción no está activa.',
  },
  cancelAlert: {
    title: 'Cancelar suscripción',
    message:
      'Tu suscripción seguirá activa hasta el final del período. ¿Quieres cancelar?',
    no: 'No',
    confirm: 'Sí, cancelar',
  },
}
