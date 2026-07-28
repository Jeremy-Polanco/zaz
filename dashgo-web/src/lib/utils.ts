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
