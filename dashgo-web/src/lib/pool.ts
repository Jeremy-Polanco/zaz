/**
 * `'2026-Q4'` → `'4.º trimestre 2026'`. Si la clave no tiene ese formato se
 * devuelve tal cual: mejor mostrar el dato crudo que esconderlo.
 */
export function quarterLabel(quarter: string): string {
  const match = /^(\d{4})-Q([1-4])$/.exec(quarter)
  if (!match) return quarter
  return `${match[2]}.º trimestre ${match[1]}`
}

// Los trimestres cierran a medianoche de Nueva York (el negocio opera ahí):
// sin `timeZone` fijo, el navegador de quien mira correría el día.
const DATE_FORMAT = new Intl.DateTimeFormat('es-US', {
  timeZone: 'America/New_York',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
})

export function formatDistributionDate(iso: string): string {
  return DATE_FORMAT.format(new Date(iso))
}
