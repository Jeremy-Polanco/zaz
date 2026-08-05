import { useEffect, useMemo, useState } from 'react'
import {
  useAdminProducts,
  useSellerCatalog,
  useSetSellerCatalog,
} from '../lib/queries'
import { Button } from './ui'
import { formatCents } from '../lib/utils'
import { serverMessage } from '../lib/utils'

type Draft = Record<string, { checked: boolean; pctText: string }>

/**
 * Editor del catálogo de un vendedor: qué productos lleva y cuánto gana por
 * cada uno.
 *
 * El `%` es lo que GANA el vendedor sobre esa línea, no lo que retiene la
 * empresa — mismo sentido que la comisión de promotores, para que las dos
 * pantallas no se lean al revés.
 *
 * Guarda con un PUT de reemplazo TOTAL (no parches por producto), así dos
 * ediciones simultáneas no dejan el catálogo mitad viejo y mitad nuevo.
 */
export function SellerCatalogPanel({
  sellerId,
  sellerName,
}: {
  sellerId: string
  sellerName: string
}) {
  const { data: products, isPending: productsPending } = useAdminProducts()
  const { data: catalog, isPending: catalogPending } = useSellerCatalog(sellerId)
  const save = useSetSellerCatalog()
  const [draft, setDraft] = useState<Draft | null>(null)
  const [error, setError] = useState<string | null>(null)

  // El draft se arma cuando llegan las dos consultas, y se rearma si cambia el
  // vendedor — si no, editarías el catálogo de uno con los datos de otro.
  useEffect(() => {
    if (!products || !catalog) return
    const byProduct = new Map(catalog.map((c) => [c.productId, c.commissionPct]))
    const next: Draft = {}
    for (const p of products) {
      const pct = byProduct.get(p.id)
      next[p.id] = {
        checked: pct !== undefined,
        pctText: pct !== undefined ? String(parseFloat(pct)) : '0',
      }
    }
    setDraft(next)
  }, [products, catalog, sellerId])

  const selectedCount = useMemo(
    () => (draft ? Object.values(draft).filter((d) => d.checked).length : 0),
    [draft],
  )

  if (productsPending || catalogPending || !draft) {
    return (
      <p className="py-4 text-sm text-ink-muted">Cargando catálogo…</p>
    )
  }

  const onSave = async () => {
    setError(null)
    const items: { productId: string; commissionPct: number }[] = []
    for (const [productId, d] of Object.entries(draft)) {
      if (!d.checked) continue
      const pct = parseFloat(d.pctText || '0')
      if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
        setError('Las comisiones tienen que ir de 0 a 100.')
        return
      }
      items.push({ productId, commissionPct: Math.round(pct * 100) / 100 })
    }
    try {
      await save.mutateAsync({ sellerId, items })
    } catch (e) {
      setError(serverMessage(e, 'No se pudo guardar el catálogo.'))
    }
  }

  return (
    <div className="flex flex-col gap-3 py-2">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[0.7rem] uppercase tracking-[0.12em] text-ink-muted">
          Catálogo de {sellerName} · {selectedCount} producto
          {selectedCount === 1 ? '' : 's'}
        </p>
        <Button size="sm" onClick={onSave} disabled={save.isPending}>
          {save.isPending ? 'Guardando…' : 'Guardar catálogo'}
        </Button>
      </div>

      {selectedCount === 0 ? (
        <p className="border-l-[3px] border-accent-dark bg-accent-light px-3 py-2 text-sm text-ink">
          Sin productos cargados: <strong>sus clientes ven el catálogo
          completo</strong> y él no gana comisión por nada. Es a propósito — un
          vendedor nuevo no deja a su cartera sin poder comprar.
        </p>
      ) : null}

      {error ? (
        <p className="border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad">
          {error}
        </p>
      ) : null}

      <ul className="flex flex-col divide-y divide-ink/5 border border-ink/10">
        {(products ?? []).map((p) => {
          const d = draft[p.id]
          if (!d) return null
          return (
            <li key={p.id} className="flex items-center gap-3 px-3 py-2">
              <input
                type="checkbox"
                id={`sp-${sellerId}-${p.id}`}
                checked={d.checked}
                onChange={(e) =>
                  setDraft((s) => ({
                    ...s!,
                    [p.id]: { ...d, checked: e.target.checked },
                  }))
                }
                className="h-4 w-4 accent-brand"
              />
              <label
                htmlFor={`sp-${sellerId}-${p.id}`}
                className="flex-1 text-sm text-ink"
              >
                {p.name}{' '}
                <span className="nums text-[0.7rem] text-ink-muted">
                  {formatCents(p.effectivePriceCents)}
                </span>
              </label>
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  max="100"
                  value={d.pctText}
                  disabled={!d.checked}
                  onChange={(e) =>
                    setDraft((s) => ({
                      ...s!,
                      [p.id]: { ...d, pctText: e.target.value },
                    }))
                  }
                  aria-label={`Comisión de ${p.name}`}
                  className="nums w-20 border border-ink/15 bg-paper px-2 py-1 text-[0.75rem] text-ink outline-none focus:border-ink disabled:opacity-40"
                />
                <span className="text-[0.7rem] text-ink-muted">%</span>
              </div>
            </li>
          )
        })}
      </ul>
      <p className="text-[0.7rem] text-ink-muted">
        El % es lo que <strong>gana el vendedor</strong> sobre esa línea.
      </p>
    </div>
  )
}
