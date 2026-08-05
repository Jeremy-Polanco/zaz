import { useEffect, useMemo, useState } from 'react'
import { Pressable, Text, TextInput, View } from 'react-native'
import {
  useAdminProducts,
  useSellerCatalog,
  useSetSellerCatalog,
} from '../lib/queries'
import { formatCents } from '../lib/format'
import { Button, FieldError } from './ui'

type Draft = Record<string, { checked: boolean; pctText: string }>

/**
 * Editor del catálogo de un vendedor. Espejo de
 * dashgo-web/src/components/SellerCatalogPanel.
 *
 * El `%` es lo que GANA el vendedor sobre esa línea, no lo que retiene la
 * empresa — mismo sentido que la comisión de promotores, para que las dos
 * pantallas no se lean al revés.
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

  // Se rearma si cambia el vendedor — si no, editarías el catálogo de uno con
  // los datos de otro.
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
      <Text className="py-3 font-sans text-[13px] text-ink-muted">
        Cargando catálogo…
      </Text>
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
    } catch {
      setError('No se pudo guardar el catálogo.')
    }
  }

  return (
    <View className="gap-3 py-2">
      <View className="flex-row items-center justify-between gap-3">
        <Text className="flex-1 font-sans text-[10px] uppercase tracking-label text-ink-muted">
          Catálogo de {sellerName} · {selectedCount} producto
          {selectedCount === 1 ? '' : 's'}
        </Text>
        <Button onPress={onSave} disabled={save.isPending}>
          {save.isPending ? 'Guardando…' : 'Guardar'}
        </Button>
      </View>

      {selectedCount === 0 ? (
        <View className="border-l-[3px] border-accent-dark bg-accent-light px-3 py-2">
          <Text className="font-sans text-[13px] leading-snug text-ink">
            Sin productos cargados: sus clientes ven el catálogo completo y él
            no gana comisión por nada. Es a propósito — un vendedor nuevo no
            deja a su cartera sin poder comprar.
          </Text>
        </View>
      ) : null}

      <FieldError message={error ?? undefined} />

      <View className="border border-ink/10">
        {(products ?? []).map((p) => {
          const d = draft[p.id]
          if (!d) return null
          return (
            <View
              key={p.id}
              className="flex-row items-center gap-3 border-b border-ink/5 px-3 py-2"
            >
              <Pressable
                onPress={() =>
                  setDraft((s) => ({
                    ...s!,
                    [p.id]: { ...d, checked: !d.checked },
                  }))
                }
                accessibilityRole="checkbox"
                accessibilityState={{ checked: d.checked }}
                accessibilityLabel={`Incluir ${p.name} en el catálogo`}
                hitSlop={6}
                className={`h-5 w-5 items-center justify-center border ${
                  d.checked ? 'border-brand bg-brand' : 'border-ink/30 bg-paper'
                }`}
              >
                {d.checked ? (
                  <Text className="font-sans-bold text-[11px] text-paper">✓</Text>
                ) : null}
              </Pressable>

              <View className="flex-1">
                <Text className="font-sans text-[14px] text-ink">{p.name}</Text>
                <Text
                  className="font-sans text-[11px] text-ink-muted"
                  style={{ fontVariant: ['tabular-nums'] }}
                >
                  {formatCents(p.effectivePriceCents)}
                </Text>
              </View>

              <View className="flex-row items-center gap-1">
                <TextInput
                  value={d.pctText}
                  editable={d.checked}
                  keyboardType="decimal-pad"
                  onChangeText={(t) =>
                    setDraft((s) => ({ ...s!, [p.id]: { ...d, pctText: t } }))
                  }
                  accessibilityLabel={`Comisión de ${p.name}`}
                  className={`w-16 border border-ink/15 px-2 py-1 text-right font-sans text-[13px] ${
                    d.checked ? 'text-ink' : 'text-ink-muted/40'
                  }`}
                  style={{ fontVariant: ['tabular-nums'] }}
                />
                <Text className="font-sans text-[11px] text-ink-muted">%</Text>
              </View>
            </View>
          )
        })}
      </View>

      <Text className="font-sans text-[11px] text-ink-muted">
        El % es lo que gana el vendedor sobre esa línea.
      </Text>
    </View>
  )
}
