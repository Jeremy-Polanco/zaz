export function formatMoney(value: string | number): string {
  const n = typeof value === 'string' ? parseFloat(value) : value
  // Whole dollars stay clean ("$20"); fractional amounts always show both
  // cent digits — never round money the customer is shown.
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: Number.isInteger(n) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(n)
}

export function formatCents(cents: number): string {
  return formatMoney(cents / 100)
}

export function formatDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/**
 * Local-day ISO string ('YYYY-MM-DD') from a Date, using the LOCAL calendar
 * fields (getFullYear/getMonth/getDate) — never toISOString(), which reads
 * UTC and would roll the day backwards in negative-UTC-offset timezones.
 */
export function isoDayFromDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/**
 * Formats a 'YYYY-MM-DD' delivery DAY (scheduledDeliveryDate) as a long,
 * human date — "martes 16 de septiembre" (es) / "Tuesday, September 16" (en).
 *
 * Builds the Date from the numeric y/m/d parts (`new Date(y, m - 1, d)`,
 * i.e. LOCAL midnight) instead of `new Date(isoDay)` (UTC midnight) — the
 * latter shifts the displayed day back by one in any negative-UTC-offset
 * timezone, which is exactly the zona-horaria bug this field was designed
 * to avoid (it's a DAY, not an instant).
 */
export function formatDeliveryDay(isoDay: string, locale: string = 'es'): string {
  const [y, m, d] = isoDay.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  if (locale === 'en') {
    return new Intl.DateTimeFormat('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    }).format(date)
  }
  // es: sin coma después del día de la semana ("martes 16 de septiembre"),
  // a diferencia del default de Intl ("martes, 16 de septiembre").
  return new Intl.DateTimeFormat('es-ES', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })
    .format(date)
    .replace(',', '')
}

export function statusLabel(status: string): string {
  const map: Record<string, string> = {
    pending_quote: 'Por cotizar',
    quoted: 'Cotizado',
    pending_validation: 'Pendiente',
    confirmed_by_colmado: 'Confirmado',
    in_delivery_route: 'En camino',
    delivered: 'Entregado',
    cancelled: 'Cancelado',
  }
  return map[status] ?? status
}
