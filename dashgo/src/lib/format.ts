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
