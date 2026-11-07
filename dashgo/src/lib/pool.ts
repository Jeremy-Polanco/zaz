/**
 * `'2026-Q4'` → `{ n: 4, year: 2026 }`. Si la clave no tiene ese formato
 * devuelve null: el que llama muestra el dato crudo (mejor eso que esconderlo).
 */
export function parseQuarter(quarter: string): { n: number; year: string } | null {
  const match = /^(\d{4})-Q([1-4])$/.exec(quarter)
  if (!match) return null
  return { n: Number(match[2]), year: match[1] }
}

/** Etiqueta en español para las pantallas `(super)` (español hardcodeado). */
export function quarterLabelEs(quarter: string): string {
  const q = parseQuarter(quarter)
  return q ? `${q.n}.º trimestre ${q.year}` : quarter
}

// Los trimestres cierran a medianoche de Nueva York (el negocio opera ahí):
// sin `timeZone` fijo, el teléfono de quien mira correría el día.
const FORMATTERS = {
  es: new Intl.DateTimeFormat('es-US', {
    timeZone: 'America/New_York',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }),
  en: new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }),
} as const

export function formatDistributionDate(iso: string, locale: 'es' | 'en'): string {
  return FORMATTERS[locale].format(new Date(iso))
}
