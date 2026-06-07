import { useEffect, useState } from 'react'
import { Button, Input, Label } from './ui'

/**
 * Permanent account-deletion confirmation (web parity with the mobile
 * DeleteAccountModal). The destructive action is gated behind typing "BORRAR"
 * exactly, so it can't be triggered by a stray click.
 */
export function DeleteAccountModal({
  open,
  onClose,
  onConfirm,
  isPending = false,
  errorMessage = null,
}: {
  open: boolean
  onClose: () => void
  onConfirm: () => void | Promise<void>
  isPending?: boolean
  errorMessage?: string | null
}) {
  const [confirmText, setConfirmText] = useState('')

  // Reset the typed confirmation each time the modal opens.
  useEffect(() => {
    if (open) setConfirmText('')
  }, [open])

  // Close on Escape (unless a deletion is in flight).
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isPending) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, isPending, onClose])

  if (!open) return null

  const confirmed = confirmText.trim().toUpperCase() === 'BORRAR'

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-0 sm:items-center sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-account-title"
      onClick={() => {
        if (!isPending) onClose()
      }}
    >
      <div
        className="w-full max-w-md rounded-t-sm border border-ink/15 bg-paper p-6 shadow-paper sm:rounded-sm"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="eyebrow text-bad">Acción permanente</span>
        <h2
          id="delete-account-title"
          className="display mt-3 text-3xl font-semibold leading-[1.05] text-ink"
        >
          ¿Eliminar tu cuenta?
        </h2>
        <p className="mt-4 text-sm leading-relaxed text-ink-muted">
          Esto borrará tu nombre, teléfono y direcciones permanentemente. Tus
          pedidos pasados quedan en nuestros registros por requisitos fiscales
          pero ya no estarán asociados a tu identidad. Esta acción no se puede
          deshacer.
        </p>

        <div className="mt-6">
          <Label htmlFor="delete-confirm">
            Escribe <span className="font-semibold text-ink">BORRAR</span> para
            confirmar
          </Label>
          <Input
            id="delete-confirm"
            value={confirmText}
            autoComplete="off"
            placeholder="BORRAR"
            disabled={isPending}
            onChange={(e) => setConfirmText(e.target.value)}
          />
        </div>

        {errorMessage && (
          <p className="mt-3 border-l-2 border-bad pl-3 text-sm font-medium text-bad">
            {errorMessage}
          </p>
        )}

        <div className="mt-6 flex items-center gap-3">
          <Button
            type="button"
            variant="secondary"
            disabled={isPending}
            onClick={onClose}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            variant="danger"
            disabled={!confirmed || isPending}
            onClick={() => void onConfirm()}
          >
            {isPending ? 'Eliminando…' : 'Eliminar →'}
          </Button>
        </div>
      </div>
    </div>
  )
}
