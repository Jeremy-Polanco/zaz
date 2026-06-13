import { useEffect, useState } from 'react'
import type { Order, UserAddress } from '../lib/types'
import {
  useCreateAddressForUser,
  useSetOrderDeliveryAddress,
} from '../lib/queries'
import { requestBrowserLocation, reverseGeocode } from '../lib/geo'
import { formatAddressShort } from '../lib/address'
import { MapPicker } from './MapPicker'
import { SavedAddressesList } from './SavedAddressesList'
import { Button, FieldError, Input, Label } from './ui'

/**
 * Super-admin drawer to pin an order's delivery location at delivery time.
 * The customer never enters an address — the colmado captures it here (GPS or
 * map), optionally saving it to the customer's address book for next time.
 */
export function OrderLocationDrawer({
  order,
  onClose,
}: {
  order: Order
  onClose: () => void
}) {
  const setOrderLocation = useSetOrderDeliveryAddress()
  const createForUser = useCreateAddressForUser(order.customerId)

  const [text, setText] = useState(order.deliveryAddress?.text ?? '')
  const [houseNumber, setHouseNumber] = useState(
    order.deliveryAddress?.houseNumber ?? '',
  )
  const [building, setBuilding] = useState(
    order.deliveryAddress?.building ?? '',
  )
  const [unit, setUnit] = useState(order.deliveryAddress?.unit ?? '')
  const [reference, setReference] = useState(
    order.deliveryAddress?.reference ?? '',
  )
  const [pin, setPin] = useState<{ lat?: number; lng?: number }>({
    lat: order.deliveryAddress?.lat ?? undefined,
    lng: order.deliveryAddress?.lng ?? undefined,
  })
  const [locating, setLocating] = useState(false)
  const [saveToUser, setSaveToUser] = useState(false)
  const [saveLabel, setSaveLabel] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const hasCoords = typeof pin.lat === 'number' && typeof pin.lng === 'number'

  const handleUseMyLocation = async () => {
    setError(null)
    setLocating(true)
    try {
      const coords = await requestBrowserLocation()
      setPin({ lat: coords.lat, lng: coords.lng })
      try {
        const rev = await reverseGeocode(coords.lat, coords.lng)
        setText((prev) => prev || rev.text)
      } catch {
        setText((prev) => prev || `${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}`)
      }
    } catch (e) {
      setError(
        (e as GeolocationPositionError)?.message ??
          'No pudimos obtener tu ubicación',
      )
    } finally {
      setLocating(false)
    }
  }

  const pickSaved = (a: UserAddress) => {
    setText(a.line1)
    setBuilding(a.building ?? '')
    setPin({ lat: a.lat, lng: a.lng })
    setError(null)
  }

  const save = async () => {
    setError(null)
    if (pin.lat === undefined || pin.lng === undefined) {
      setError('Marcá la ubicación (usá tu ubicación o el mapa)')
      return
    }
    if (saveToUser && !saveLabel.trim()) {
      setError('Ponle un nombre a la dirección para guardarla')
      return
    }
    try {
      await setOrderLocation.mutateAsync({
        id: order.id,
        text: text.trim(),
        lat: pin.lat,
        lng: pin.lng,
        building: building.trim() || undefined,
        houseNumber: houseNumber.trim() || undefined,
        unit: unit.trim() || undefined,
        reference: reference.trim() || undefined,
      })
      if (saveToUser && saveLabel.trim() && order.customerId) {
        try {
          await createForUser.mutateAsync({
            label: saveLabel.trim(),
            line1: text.trim() || saveLabel.trim(),
            lat: pin.lat,
            lng: pin.lng,
            building: building.trim() || undefined,
          })
        } catch {
          // Non-blocking: the order location was set regardless.
        }
      }
      onClose()
    } catch (err) {
      setError(
        (err as Error & { response?: { data?: { message?: string } } })
          ?.response?.data?.message ?? 'No pudimos fijar la ubicación',
      )
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-end bg-ink/40">
      <button
        type="button"
        aria-label="Cerrar"
        onClick={onClose}
        className="absolute inset-0 h-full w-full cursor-default"
      />
      <aside className="relative z-10 flex h-full w-full max-w-md flex-col overflow-y-auto border-l border-ink/15 bg-paper p-8">
        <header className="mb-6">
          <span className="eyebrow">Fijar ubicación</span>
          <h2 className="display mt-2 text-3xl font-semibold leading-[1] tracking-[-0.02em]">
            {order.customer?.fullName ?? 'Cliente'}
          </h2>
          <p className="mt-2 text-sm text-ink-soft">
            {order.deliveryAddress
              ? `Actual: ${formatAddressShort(order.deliveryAddress)}`
              : 'Sin ubicación aún — fijala al llegar.'}
          </p>
        </header>

        {/* Pick from the customer's saved addresses */}
        <section className="mb-6">
          <h3 className="eyebrow mb-3">Direcciones guardadas del cliente</h3>
          <SavedAddressesList userId={order.customerId} onPick={pickSaved} />
        </section>

        {/* Capture a fresh location */}
        <section className="mb-6 border-t border-ink/10 pt-5">
          <Label htmlFor="loc-text">Dirección</Label>
          <Input
            id="loc-text"
            placeholder="Calle, número, referencia…"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />

          <div className="mt-3 grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="loc-house">N° de casa</Label>
              <Input
                id="loc-house"
                placeholder="Ej. 24"
                value={houseNumber}
                onChange={(e) => setHouseNumber(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="loc-unit">Apto / Piso</Label>
              <Input
                id="loc-unit"
                placeholder="Ej. Apto 3B"
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
              />
            </div>
          </div>

          <div className="mt-3">
            <Label htmlFor="loc-building">Edificio</Label>
            <Input
              id="loc-building"
              placeholder="Ej. Edif. 4, Torre B"
              value={building}
              onChange={(e) => setBuilding(e.target.value)}
            />
          </div>

          <div className="mt-3">
            <Label htmlFor="loc-reference">Referencia / punto</Label>
            <Input
              id="loc-reference"
              placeholder="Ej. frente al colmado, casa amarilla"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
            />
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={handleUseMyLocation}
              disabled={locating}
            >
              {locating ? 'Ubicando…' : '📍 Usar mi ubicación'}
            </Button>
            {hasCoords ? (
              <span className="nums text-[0.65rem] uppercase tracking-[0.14em] text-ink-muted">
                {pin.lat!.toFixed(5)}, {pin.lng!.toFixed(5)}
              </span>
            ) : (
              <span className="text-[0.65rem] uppercase tracking-[0.14em] text-bad">
                Marcá la ubicación
              </span>
            )}
          </div>

          <p className="mt-5 mb-2 text-[0.7rem] uppercase tracking-[0.18em] text-ink-muted">
            Ajustá el pin en el mapa
          </p>
          <MapPicker
            value={pin}
            onChange={({ lat, lng }) => setPin({ lat, lng })}
          />

          <div className="mt-5">
            <label className="flex cursor-pointer items-center gap-3">
              <input
                type="checkbox"
                checked={saveToUser}
                onChange={(e) => {
                  setSaveToUser(e.target.checked)
                  setError(null)
                }}
                className="h-4 w-4 accent-accent"
              />
              <span className="text-sm font-medium text-ink">
                Guardar esta dirección al cliente
              </span>
            </label>
            {saveToUser && (
              <div className="mt-3">
                <Label htmlFor="loc-label">Nombre de la dirección</Label>
                <Input
                  id="loc-label"
                  placeholder="Ej. Casa, Trabajo"
                  value={saveLabel}
                  onChange={(e) => setSaveLabel(e.target.value)}
                />
              </div>
            )}
          </div>
        </section>

        {error && <FieldError message={error} />}

        <div className="mt-auto flex flex-col gap-3 pt-2">
          <Button
            variant="accent"
            size="lg"
            onClick={save}
            disabled={setOrderLocation.isPending || !hasCoords}
            className="w-full"
          >
            {setOrderLocation.isPending ? 'Guardando…' : 'Guardar ubicación →'}
          </Button>
          <Button
            variant="secondary"
            size="lg"
            onClick={onClose}
            disabled={setOrderLocation.isPending}
            className="w-full"
          >
            Cancelar
          </Button>
        </div>
      </aside>
    </div>
  )
}
