import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link } from '@tanstack/react-router'
import { Button, FieldError, Input, Label } from './ui'
import {
  useCreateAddress,
  useMyAddresses,
  useSetDefaultAddress,
} from '../lib/queries'
import { requestBrowserLocation, reverseGeocode } from '../lib/geo'
import type { UserAddress } from '../lib/types'

function PinIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="shrink-0"
    >
      <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  )
}

function ChevronIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="shrink-0 text-ink-muted"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  )
}

/**
 * Header affordance (clients) showing the active delivery address. Opens a modal
 * to swap between saved addresses or quick-add a new one. The modal is portaled
 * to <body> because the header's `backdrop-blur` would otherwise trap a fixed
 * overlay inside the bar (same reason MobileNav portals).
 */
export function AddressSwitcher() {
  const { data: addresses } = useMyAddresses()
  const [open, setOpen] = useState(false)

  const list = addresses ?? []
  const active = list.find((a) => a.isDefault) ?? list[0] ?? null

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="inline-flex max-w-[44vw] items-center gap-1.5 rounded-xs border border-ink/15 px-2.5 py-1.5 text-left text-ink transition-colors hover:bg-ink/5 sm:max-w-[220px]"
      >
        <PinIcon />
        <span className="flex min-w-0 flex-col leading-tight">
          <span className="hidden text-[0.55rem] uppercase tracking-[0.14em] text-ink-muted sm:block">
            Entregar en
          </span>
          <span className="truncate text-sm font-medium text-ink">
            {active ? active.label : 'Agregar dirección'}
          </span>
        </span>
        <ChevronIcon />
      </button>

      {open && (
        <AddressSwitcherModal addresses={list} onClose={() => setOpen(false)} />
      )}
    </>
  )
}

function AddressSwitcherModal({
  addresses,
  onClose,
}: {
  addresses: UserAddress[]
  onClose: () => void
}) {
  const setDefault = useSetDefaultAddress()
  const createAddress = useCreateAddress()

  const [showAdd, setShowAdd] = useState(addresses.length === 0)
  const [newLabel, setNewLabel] = useState('')
  const [newLine1, setNewLine1] = useState('')
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null)
  const [locating, setLocating] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  // Escape to close + lock body scroll while open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [onClose])

  const swap = (id: string) => {
    setDefault.mutate(id, { onSuccess: () => onClose() })
  }

  const handleUseMyLocation = async () => {
    setFormError(null)
    setLocating(true)
    try {
      const c = await requestBrowserLocation()
      setCoords({ lat: c.lat, lng: c.lng })
      try {
        const rev = await reverseGeocode(c.lat, c.lng)
        setNewLine1((prev) => prev || rev.text)
      } catch {
        // keep whatever the user typed
      }
    } catch (e) {
      setFormError(
        (e as GeolocationPositionError)?.message ??
          'No pudimos obtener tu ubicación',
      )
    } finally {
      setLocating(false)
    }
  }

  const canSave =
    newLabel.trim().length > 0 &&
    newLine1.trim().length >= 5 &&
    coords !== null

  const handleSave = async () => {
    if (!canSave || !coords) {
      setFormError('Completá el nombre, la dirección y tu ubicación')
      return
    }
    try {
      const created = await createAddress.mutateAsync({
        label: newLabel.trim(),
        line1: newLine1.trim(),
        lat: coords.lat,
        lng: coords.lng,
      })
      // Make the freshly-added address the active one, then close.
      await setDefault.mutateAsync(created.id)
      onClose()
    } catch (e) {
      setFormError(
        (e as Error & { response?: { data?: { message?: string } } })?.response
          ?.data?.message ?? 'No pudimos guardar la dirección',
      )
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-0 sm:items-center sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="address-switcher-title"
      onClick={onClose}
    >
      <div
        className="max-h-[88vh] w-full max-w-md overflow-y-auto rounded-t-sm border border-ink/15 bg-paper p-6 shadow-paper sm:rounded-sm"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <span className="eyebrow">Entrega</span>
            <h2
              id="address-switcher-title"
              className="display mt-2 text-3xl font-semibold leading-[1.05] text-ink"
            >
              ¿Dónde te lo llevamos?
            </h2>
          </div>
          <button
            type="button"
            aria-label="Cerrar"
            onClick={onClose}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xs border border-ink/15 text-ink transition-colors hover:bg-ink/5"
          >
            ✕
          </button>
        </div>

        {/* Saved addresses — tap one to make it the active destination */}
        {addresses.length > 0 && (
          <ul className="mt-6 flex flex-col gap-2">
            {addresses.map((a) => {
              const isActive = a.isDefault
              const swapping = setDefault.isPending && setDefault.variables === a.id
              return (
                <li key={a.id}>
                  <button
                    type="button"
                    onClick={() => swap(a.id)}
                    disabled={isActive || setDefault.isPending}
                    aria-current={isActive}
                    className={`flex w-full items-center justify-between gap-3 border px-4 py-3 text-left transition-colors ${
                      isActive
                        ? 'border-ink bg-ink text-paper'
                        : 'border-ink/20 hover:border-ink/40 disabled:opacity-60'
                    }`}
                  >
                    <span className="min-w-0">
                      <span className="block font-medium">{a.label}</span>
                      <span
                        className={`block truncate text-sm ${
                          isActive ? 'text-paper/70' : 'text-ink-muted'
                        }`}
                      >
                        {a.line1}
                        {a.line2 ? `, ${a.line2}` : ''}
                      </span>
                    </span>
                    <span className="shrink-0 text-[0.62rem] uppercase tracking-[0.14em]">
                      {isActive ? '✓ Activa' : swapping ? 'Cambiando…' : 'Elegir'}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}

        {/* Quick-add */}
        <div className="mt-6 border-t border-ink/10 pt-5">
          {!showAdd ? (
            <Button
              type="button"
              variant="secondary"
              onClick={() => setShowAdd(true)}
            >
              + Agregar nueva dirección
            </Button>
          ) : (
            <div className="flex flex-col gap-4">
              <span className="eyebrow">Nueva dirección</span>
              <div>
                <Label htmlFor="sw-label">Nombre</Label>
                <Input
                  id="sw-label"
                  placeholder="Casa, Trabajo, Gym"
                  value={newLabel}
                  onChange={(e) => setNewLabel(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="sw-line1">Dirección</Label>
                <Input
                  id="sw-line1"
                  placeholder="1234 Broadway, Washington Heights"
                  value={newLine1}
                  onChange={(e) => setNewLine1(e.target.value)}
                />
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={handleUseMyLocation}
                  disabled={locating}
                >
                  {locating ? 'Ubicando…' : '📍 Usar mi ubicación'}
                </Button>
                {coords ? (
                  <span className="nums text-[0.65rem] uppercase tracking-[0.14em] text-ink-muted">
                    {coords.lat.toFixed(5)}, {coords.lng.toFixed(5)}
                  </span>
                ) : (
                  <span className="text-[0.65rem] uppercase tracking-[0.14em] text-bad">
                    Necesitamos tu ubicación para calcular el envío
                  </span>
                )}
              </div>
              {formError && <FieldError message={formError} />}
              <div className="flex items-center gap-3">
                <Button
                  type="button"
                  onClick={() => void handleSave()}
                  disabled={!canSave || createAddress.isPending || setDefault.isPending}
                >
                  {createAddress.isPending ? 'Guardando…' : 'Guardar y usar'}
                </Button>
                {addresses.length > 0 && (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setShowAdd(false)}
                  >
                    Cancelar
                  </Button>
                )}
              </div>
              <Link
                to="/direcciones/nueva"
                onClick={onClose}
                className="text-sm text-ink-muted underline underline-offset-4 transition-colors hover:text-brand"
              >
                Agregar con mapa y más detalles →
              </Link>
            </div>
          )}
        </div>

        <div className="mt-6 border-t border-ink/10 pt-4">
          <Link
            to="/direcciones"
            onClick={onClose}
            className="text-sm font-medium text-ink underline underline-offset-4 transition-colors hover:text-brand"
          >
            Administrar mis direcciones →
          </Link>
        </div>
      </div>
    </div>,
    document.body,
  )
}
