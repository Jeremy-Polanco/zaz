import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatMoney(amount: string | number) {
  const n = typeof amount === 'string' ? parseFloat(amount) : amount
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n)
}

export function formatCents(cents: number) {
  return formatMoney(cents / 100)
}

/**
 * Pulls the API's error message out of an axios rejection, falling back to
 * `fallback` when there isn't a usable one.
 *
 * Admin panels must show WHY a mutation failed. A hardcoded "Intentá de nuevo"
 * makes a 403 ("no podés eliminar tu propia cuenta") look identical to a real
 * crash, which is how a working endpoint gets reported as broken.
 *
 * Nest's ValidationPipe sends `message` as a string[]; joining that produces
 * worse copy than the caller's fallback, so anything non-string is treated as
 * absent.
 */
export function serverMessage(err: unknown, fallback: string): string {
  const message = (
    err as { response?: { data?: { message?: unknown } } } | null | undefined
  )?.response?.data?.message
  return typeof message === 'string' && message.trim() !== ''
    ? message
    : fallback
}

export function formatDate(iso: string) {
  return new Date(iso).toLocaleString('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

/**
 * Formats a bare 'YYYY-MM-DD' DAY (no time, no timezone — e.g.
 * `scheduledDeliveryDate`) as "martes 16 de septiembre" in Spanish.
 *
 * Deliberately does NOT go through `new Date(isoDay)`: that parses the string
 * as UTC midnight, and a viewer west of Greenwich (Udash ops are in New
 * Jersey) then renders it back as the PREVIOUS day. Building the Date from
 * the numeric y/m/d parts constructs local midnight instead, so the day never
 * shifts regardless of the viewer's timezone.
 */
export function formatDeliveryDay(isoDay: string): string {
  const [year, month, day] = isoDay.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  return date
    .toLocaleDateString('es-AR', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    })
    .replace(', ', ' ')
}

/**
 * Local 'YYYY-MM-DD' for a Date — the admin's <input type="date"> value and
 * the `min` bound (today) both need this, built from local y/m/d so it never
 * drifts a day off from what the picker shows on screen.
 */
export function isoDayFromDate(d: Date): string {
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}
