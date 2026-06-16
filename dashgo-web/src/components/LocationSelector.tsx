import { useMemo } from 'react'
import { useCurrentUser } from '../lib/auth'
import { useMyAddresses, useSetActiveLocation } from '../lib/queries'

/**
 * Repartidor location switcher (web).
 *
 * Lets a SUPER_ADMIN_DELIVERY user with multiple saved locations choose which
 * one they're currently operating from. The selection sets `active_location_id`
 * on the server, which the backend uses as the shipping origin
 * (ShippingService.getOrigin).
 *
 * Renders nothing unless the user is a repartidor with 2+ locations — there's
 * nothing to choose with zero or one. The "current" value falls back to the
 * default address (then the first) when no explicit selection exists, mirroring
 * the backend's resolution order.
 */
export function LocationSelector() {
  const { data: user } = useCurrentUser()
  const { data: addresses } = useMyAddresses()
  const setActive = useSetActiveLocation()

  const currentId = useMemo(() => {
    if (!addresses || addresses.length === 0) return ''
    if (user?.activeLocationId && addresses.some((a) => a.id === user.activeLocationId)) {
      return user.activeLocationId
    }
    return (addresses.find((a) => a.isDefault) ?? addresses[0]).id
  }, [addresses, user?.activeLocationId])

  // Only the repartidor manages a dispatch location, and only when there's a
  // real choice to make (2+ locations).
  if (user?.role !== 'super_admin_delivery') return null
  if (!addresses || addresses.length < 2) return null

  return (
    <label className="hidden items-center gap-2 md:flex" title="Ubicación de despacho">
      <span className="text-ink/50" aria-hidden>
        <PinIcon />
      </span>
      <span className="sr-only">Ubicación de despacho activa</span>
      <select
        value={currentId}
        disabled={setActive.isPending}
        onChange={(e) => setActive.mutate(e.target.value)}
        className="h-9 max-w-48 rounded-full border border-ink/15 bg-paper px-3 text-sm font-medium text-ink focus:border-ink focus:outline-none disabled:opacity-60 transition-colors"
      >
        {addresses.map((a) => (
          <option key={a.id} value={a.id}>
            {a.label}
          </option>
        ))}
      </select>
    </label>
  )
}

function PinIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M8 1.5a4.5 4.5 0 0 0-4.5 4.5c0 3.2 4.5 8 4.5 8s4.5-4.8 4.5-8A4.5 4.5 0 0 0 8 1.5Z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
      <circle cx="8" cy="6" r="1.6" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  )
}
