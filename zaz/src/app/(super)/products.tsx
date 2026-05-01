import { useMemo, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import {
  useAdminProducts,
  useCategories,
  useCreateProduct,
  useDeleteProduct,
  useUpdateInventory,
  useUpdateProduct,
} from '../../lib/queries'
import type { Product } from '../../lib/types'
import {
  BoltIcon,
  Button,
  Card,
  Eyebrow,
  FieldError,
  FieldLabel,
  Hairline,
  KpiCard,
  Metric,
  PlaceholderImage,
  SectionHead,
} from '../../components/ui'
import { formatCents } from '../../lib/format'

// Sentinel: when the operator opts out of stock tracking, save with this large
// number so catalog/checkout never report "sin stock". Real intent preserved
// client-side via tracksStock.
const UNTRACKED_STOCK = 99999

type FormState = {
  name: string
  description: string
  priceText: string
  stockText: string
  tracksStock: boolean
  isAvailable: boolean
  categoryId: string | null
  promoterCommissionText: string
  pointsText: string
  offerLabel: string
  offerDiscountText: string
  offerStartsAt: string
  offerEndsAt: string
  offerOpen: boolean
  errors: {
    name?: string
    priceText?: string
    stockText?: string
    promoterCommissionText?: string
    pointsText?: string
    offerDiscountText?: string
    offerStartsAt?: string
    offerEndsAt?: string
  }
}

const emptyForm: FormState = {
  name: '',
  description: '',
  priceText: '',
  stockText: '',
  tracksStock: true,
  isAvailable: true,
  categoryId: null,
  promoterCommissionText: '0',
  pointsText: '1',
  offerLabel: '',
  offerDiscountText: '',
  offerStartsAt: '',
  offerEndsAt: '',
  offerOpen: false,
  errors: {},
}

function parseOptionalDate(value: string): string | null | undefined {
  const trimmed = value.trim()
  if (trimmed === '') return null
  const d = new Date(trimmed)
  if (Number.isNaN(d.getTime())) return undefined
  return d.toISOString()
}

type ProductTab = 'identidad' | 'precio' | 'inventario' | 'avanzado'

const TABS: Array<{ id: ProductTab; n: string; label: string }> = [
  { id: 'identidad', n: '01', label: 'Identidad' },
  { id: 'precio', n: '02', label: 'Precio' },
  { id: 'inventario', n: '03', label: 'Inventario' },
  { id: 'avanzado', n: '04', label: 'Avanzado' },
]

function ProductForm({
  editing,
  onDone,
}: {
  editing: Product | null
  onDone: () => void
}) {
  const create = useCreateProduct()
  const update = useUpdateProduct()
  const updateInventory = useUpdateInventory()
  const { data: categories } = useCategories()
  const [tab, setTab] = useState<ProductTab>('identidad')
  const [state, setState] = useState<FormState>(() => {
    if (!editing) return emptyForm
    const editingStock = editing.stock ?? 0
    const editingTracksStock = editingStock < UNTRACKED_STOCK
    return {
      name: editing.name,
      description: editing.description ?? '',
      priceText: editing.priceToPublic,
      stockText: editingTracksStock ? String(editingStock) : '',
      tracksStock: editingTracksStock,
      isAvailable: editing.isAvailable,
      categoryId: editing.categoryId ?? null,
      promoterCommissionText: editing.promoterCommissionPct ?? '0',
      pointsText: editing.pointsPct ?? '1',
      offerLabel: editing.offerLabel ?? '',
      offerDiscountText: editing.offerDiscountPct ?? '',
      offerStartsAt: editing.offerStartsAt
        ? editing.offerStartsAt.slice(0, 10)
        : '',
      offerEndsAt: editing.offerEndsAt
        ? editing.offerEndsAt.slice(0, 10)
        : '',
      offerOpen: Boolean(
        editing.offerLabel ||
          editing.offerDiscountPct ||
          editing.offerStartsAt ||
          editing.offerEndsAt,
      ),
      errors: {},
    }
  })
  const pending = create.isPending || update.isPending

  const onSubmit = async () => {
    const errors: FormState['errors'] = {}
    if (state.name.trim().length < 2) errors.name = 'Mínimo 2 caracteres'
    const price = parseFloat(state.priceText)
    if (!Number.isFinite(price) || price <= 0)
      errors.priceText = 'Ingresa un precio válido'

    // Stock: only validated when the operator chose to track it.
    let stock: number
    if (state.tracksStock) {
      stock = state.stockText.trim() === '' ? 0 : parseInt(state.stockText, 10)
      if (!Number.isFinite(stock) || stock < 0)
        errors.stockText = 'Stock inválido'
    } else {
      // Untracked → sentinel so catalog never reports "sin stock".
      stock = UNTRACKED_STOCK
    }

    const commission = parseFloat(state.promoterCommissionText || '0')
    if (!Number.isFinite(commission) || commission < 0 || commission > 100)
      errors.promoterCommissionText = '0 a 100'

    const points = parseFloat(state.pointsText || '0')
    if (!Number.isFinite(points) || points < 0 || points > 100)
      errors.pointsText = '0 a 100'

    let offerDiscount: number | null = null
    if (state.offerOpen && state.offerDiscountText.trim() !== '') {
      const d = parseFloat(state.offerDiscountText)
      if (!Number.isFinite(d) || d <= 0 || d > 100)
        errors.offerDiscountText = '1 a 100'
      else offerDiscount = d
    }

    const offerStartsIso = state.offerOpen
      ? parseOptionalDate(state.offerStartsAt)
      : null
    if (offerStartsIso === undefined) errors.offerStartsAt = 'YYYY-MM-DD'
    const offerEndsIso = state.offerOpen
      ? parseOptionalDate(state.offerEndsAt)
      : null
    if (offerEndsIso === undefined) errors.offerEndsAt = 'YYYY-MM-DD'

    if (Object.keys(errors).length > 0) {
      setState((s) => ({ ...s, errors }))
      return
    }

    const payload = {
      name: state.name.trim(),
      description: state.description.trim() || undefined,
      priceToPublic: price,
      stock,
      categoryId: state.categoryId,
      promoterCommissionPct: commission,
      pointsPct: points,
      offerLabel: state.offerOpen ? state.offerLabel.trim() || null : null,
      offerDiscountPct: state.offerOpen ? offerDiscount : null,
      offerStartsAt: state.offerOpen ? (offerStartsIso ?? null) : null,
      offerEndsAt: state.offerOpen ? (offerEndsIso ?? null) : null,
    }

    try {
      const saved = editing
        ? await update.mutateAsync({ id: editing.id, ...payload })
        : await create.mutateAsync(payload)
      // Sync isAvailable + final stock through inventory endpoint, since the
      // create/update DTOs don't accept isAvailable and stock changes from the
      // tracksStock toggle need to land too.
      const needsInventorySync =
        editing == null
          ? state.isAvailable === false || stock !== (saved.stock ?? 0)
          : state.isAvailable !== editing.isAvailable ||
            stock !== (editing.stock ?? 0)
      if (needsInventorySync) {
        await updateInventory.mutateAsync({
          productId: saved.id,
          isAvailable: state.isAvailable,
          stock,
        })
      }
      onDone()
    } catch (e) {
      const msg =
        (e as { response?: { data?: { message?: string } } })?.response?.data
          ?.message ?? 'No se pudo guardar'
      Alert.alert('Error', msg)
    }
  }

  // Live preview helpers
  const priceN = parseFloat(state.priceText) || 0
  const discountN = parseFloat(state.offerDiscountText) || 0
  const offerEffective =
    state.offerOpen && discountN > 0
      ? priceN * (1 - discountN / 100)
      : null
  const stockN = parseInt(state.stockText, 10) || 0
  const previewLabel = state.name.slice(0, 3).toUpperCase() || '—'
  const selectedCategory = (categories ?? []).find(
    (c) => c.id === state.categoryId,
  )

  // Validation booleans (drives checklist)
  const v = {
    name: state.name.trim().length >= 2,
    category: state.categoryId !== null,
    price: priceN > 0,
    stock: stockN >= 0 && state.stockText.trim() !== '',
    offer:
      !state.offerOpen ||
      (discountN > 0 && discountN <= 100),
  }
  const allValid = Object.values(v).every(Boolean)

  return (
    <View className="mb-8 border border-ink/15 bg-paper">
      {/* Header */}
      <View className="flex-row items-start justify-between border-b border-ink/10 px-5 py-4">
        <View className="flex-1 pr-3">
          <View className="flex-row items-center gap-2">
            <BoltIcon size={11} color="#220247" />
            <Text className="font-sans-medium text-[10px] uppercase tracking-eyebrow text-brand">
              {editing ? 'Editando' : 'Nuevo'} · Producto
            </Text>
          </View>
          <Text
            className="mt-2 font-sans-semibold text-[22px] leading-[26px] text-ink"
            numberOfLines={1}
          >
            {state.name || (
              <Text className="font-sans-italic text-ink-muted">
                Sin nombre todavía
              </Text>
            )}
          </Text>
        </View>
        <View
          className={`h-6 px-2 ${
            v.name && v.price ? 'bg-ok/15' : 'bg-warn/15'
          }`}
        >
          <Text
            className={`font-sans-medium text-[10px] uppercase tracking-label leading-6 ${
              v.name && v.price ? 'text-ok' : 'text-warn'
            }`}
          >
            {v.name && v.price ? 'OK' : 'Borrador'}
          </Text>
        </View>
      </View>

      {/* Live preview */}
      <View className="border-b border-ink/10 bg-paper-deep/40 px-5 py-4">
        <Text className="mb-2 font-sans-medium text-[9px] uppercase tracking-label text-ink-muted">
          Vista previa · catálogo
        </Text>
        <View className="flex-row gap-3 bg-paper p-3">
          <View className="relative">
            <PlaceholderImage label={previewLabel} size={56} />
            {state.offerOpen && discountN > 0 && (
              <View className="absolute left-0 top-0 bg-accent px-1 py-0.5">
                <Text className="font-sans-semibold text-[7px] uppercase tracking-label text-brand-dark">
                  Oferta
                </Text>
              </View>
            )}
          </View>
          <View className="flex-1 min-w-0">
            <Text
              className="font-sans-semibold text-[13px] text-ink"
              numberOfLines={1}
            >
              {state.name || (
                <Text className="text-ink-muted">Sin nombre</Text>
              )}
            </Text>
            <Text
              className="mt-0.5 font-sans text-[11px] text-ink-muted"
              numberOfLines={1}
            >
              {state.description || 'Sin descripción'}
            </Text>
            <View className="mt-1.5 flex-row items-baseline gap-1.5">
              {offerEffective !== null && (
                <Text
                  className="font-sans text-[10px] text-ink-muted line-through"
                  style={{ fontVariant: ['tabular-nums'] }}
                >
                  ${priceN.toFixed(2)}
                </Text>
              )}
              <Text
                className="font-sans-semibold text-[14px] text-brand"
                style={{ fontVariant: ['tabular-nums'] }}
              >
                ${(offerEffective ?? priceN).toFixed(2)}
              </Text>
            </View>
          </View>
        </View>
      </View>

      {/* Tabs */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 20, gap: 24 }}
        className="border-b border-ink/10"
      >
        {TABS.map((t) => {
          const sel = tab === t.id
          return (
            <Pressable
              key={t.id}
              onPress={() => setTab(t.id)}
              className="flex-row items-baseline gap-2 py-3.5"
              style={{
                borderBottomColor: sel ? '#F5E447' : 'transparent',
                borderBottomWidth: 2,
              }}
            >
              <Text
                className={`font-sans-italic text-[14px] ${
                  sel ? 'text-brand' : 'text-ink-muted'
                }`}
                style={{ fontVariant: ['tabular-nums'] }}
              >
                {t.n}
              </Text>
              <Text
                className={`font-sans-semibold text-[12px] ${
                  sel ? 'text-ink' : 'text-ink-muted'
                }`}
              >
                {t.label}
              </Text>
            </Pressable>
          )
        })}
      </ScrollView>

      {/* Tab content */}
      <View className="px-5 py-5">
        {tab === 'identidad' && (
          <View className="gap-5">
            <SectionHeader letter="A" title="Información básica" hint="Lo que ve el cliente al abrir el producto." />

            <View>
              <FieldLabel>Nombre</FieldLabel>
              <TextInput
                className="h-11 border-b border-ink/25 pb-1 font-sans text-[16px] text-ink"
                placeholder="Garrafón Planeta Azul"
                placeholderTextColor="#6B6488"
                value={state.name}
                onChangeText={(t) => setState((s) => ({ ...s, name: t }))}
              />
              <FieldError message={state.errors.name} />
              <Text className="mt-1 font-sans text-[10px] text-ink-muted">
                2+ caracteres. Aparece en catálogo, checkout, factura.
              </Text>
            </View>

            <View>
              <FieldLabel>Descripción</FieldLabel>
              <TextInput
                className="min-h-[72px] border-b border-ink/25 pb-1 pt-2 font-sans text-[15px] text-ink"
                placeholder="Jarra retornable de 2.5 galones."
                placeholderTextColor="#6B6488"
                multiline
                textAlignVertical="top"
                value={state.description}
                onChangeText={(t) =>
                  setState((s) => ({ ...s, description: t }))
                }
              />
              <Text className="mt-1 font-sans text-[10px] text-ink-muted">
                2 líneas como máximo. Se trunca en catálogo.
              </Text>
            </View>

            <View>
              <FieldLabel>Categoría</FieldLabel>
              <View className="mt-2 gap-2">
                <Pressable
                  onPress={() =>
                    setState((s) => ({ ...s, categoryId: null }))
                  }
                  className={`flex-row items-center gap-3 border px-3 py-3 ${
                    state.categoryId === null
                      ? 'border-brand bg-brand-light'
                      : 'border-ink/15 bg-paper'
                  }`}
                >
                  <Text className="text-[20px]">·</Text>
                  <Text
                    className={`font-sans-semibold text-[13px] ${
                      state.categoryId === null ? 'text-brand' : 'text-ink'
                    }`}
                  >
                    Sin categoría
                  </Text>
                </Pressable>
                {(categories ?? []).map((c) => {
                  const sel = state.categoryId === c.id
                  return (
                    <Pressable
                      key={c.id}
                      onPress={() =>
                        setState((s) => ({ ...s, categoryId: c.id }))
                      }
                      className={`flex-row items-center gap-3 border px-3 py-3 ${
                        sel
                          ? 'border-brand bg-brand-light'
                          : 'border-ink/15 bg-paper'
                      }`}
                    >
                      <Text className="text-[20px]">{c.iconEmoji ?? '📦'}</Text>
                      <View className="flex-1">
                        <Text
                          className={`font-sans-semibold text-[13px] ${
                            sel ? 'text-brand' : 'text-ink'
                          }`}
                        >
                          {c.name}
                        </Text>
                        <Text
                          className={`font-sans text-[10px] ${
                            sel ? 'text-brand' : 'text-ink-muted'
                          }`}
                        >
                          /{c.slug}
                        </Text>
                      </View>
                      {sel && (
                        <View className="h-4 w-4 items-center justify-center bg-brand">
                          <Text className="font-sans-semibold text-[10px] text-paper">✓</Text>
                        </View>
                      )}
                    </Pressable>
                  )
                })}
              </View>
            </View>
          </View>
        )}

        {tab === 'precio' && (
          <View className="gap-5">
            <SectionHeader letter="B" title="Precio" hint="USD. Tax y envío se calculan en checkout." />

            <View>
              <FieldLabel>Precio base</FieldLabel>
              <View className="mt-1 flex-row items-center border-b border-ink/25">
                <Text className="pr-2 font-sans text-[16px] text-ink-muted">$</Text>
                <TextInput
                  className="flex-1 h-11 pb-1 font-sans text-[16px] text-ink"
                  placeholder="7.50"
                  placeholderTextColor="#6B6488"
                  keyboardType="decimal-pad"
                  value={state.priceText}
                  onChangeText={(t) =>
                    setState((s) => ({ ...s, priceText: t }))
                  }
                  style={{ fontVariant: ['tabular-nums'] }}
                />
                <Text className="font-sans text-[10px] uppercase tracking-label text-ink-muted">
                  USD
                </Text>
              </View>
              <FieldError message={state.errors.priceText} />
            </View>

            {/* Offer toggle */}
            <Pressable
              onPress={() =>
                setState((s) => ({ ...s, offerOpen: !s.offerOpen }))
              }
              className={`flex-row items-center gap-3 border px-3 py-3 ${
                state.offerOpen
                  ? 'border-accent-dark bg-accent-light'
                  : 'border-ink/15 bg-paper'
              }`}
            >
              <View
                className={`h-5 w-9 rounded-full p-0.5 ${
                  state.offerOpen ? 'bg-brand' : 'bg-ink/15'
                }`}
              >
                <View
                  className={`h-4 w-4 rounded-full ${
                    state.offerOpen ? 'bg-accent' : 'bg-paper'
                  }`}
                  style={{
                    transform: [
                      { translateX: state.offerOpen ? 14 : 0 },
                    ],
                  }}
                />
              </View>
              <View className="flex-1">
                <Text className="font-sans-semibold text-[13px] text-ink">
                  Oferta activa
                </Text>
                <Text className="mt-0.5 font-sans text-[11px] text-ink-muted">
                  {state.offerOpen
                    ? `Descuento ${discountN || 0}%`
                    : 'Sin descuento'}
                </Text>
              </View>
            </Pressable>

            {state.offerOpen && (
              <View className="gap-4">
                <View>
                  <FieldLabel>Etiqueta promocional</FieldLabel>
                  <TextInput
                    className="h-11 border-b border-ink/25 pb-1 font-sans text-[16px] text-ink"
                    placeholder="¡Promo lanzamiento!"
                    placeholderTextColor="#6B6488"
                    value={state.offerLabel}
                    maxLength={40}
                    onChangeText={(t) =>
                      setState((s) => ({ ...s, offerLabel: t }))
                    }
                  />
                </View>

                <View>
                  <FieldLabel>Descuento %</FieldLabel>
                  <TextInput
                    className="h-11 border-b border-ink/25 pb-1 font-sans text-[16px] text-ink"
                    placeholder="15"
                    placeholderTextColor="#6B6488"
                    keyboardType="decimal-pad"
                    value={state.offerDiscountText}
                    onChangeText={(t) =>
                      setState((s) => ({ ...s, offerDiscountText: t }))
                    }
                    style={{ fontVariant: ['tabular-nums'] }}
                  />
                  <FieldError message={state.errors.offerDiscountText} />
                </View>

                {discountN > 0 && priceN > 0 && (
                  <View
                    className="border-l-[3px] border-accent-dark bg-accent-light px-3 py-2.5"
                    style={{ borderLeftWidth: 3 }}
                  >
                    <Text className="font-sans text-[12px] text-ink">
                      Estás descontando{' '}
                      <Text
                        className="font-sans-semibold"
                        style={{ fontVariant: ['tabular-nums'] }}
                      >
                        {discountN.toFixed(0)}%
                      </Text>
                      . Le ahorras al cliente{' '}
                      <Text
                        className="font-sans-semibold"
                        style={{ fontVariant: ['tabular-nums'] }}
                      >
                        ${(priceN - (offerEffective ?? priceN)).toFixed(2)}
                      </Text>
                      .
                    </Text>
                  </View>
                )}

                <View className="flex-row gap-3">
                  <View className="flex-1">
                    <FieldLabel>Desde</FieldLabel>
                    <TextInput
                      className="h-11 border-b border-ink/25 pb-1 font-sans text-[14px] text-ink"
                      placeholder="2026-04-20"
                      placeholderTextColor="#6B6488"
                      value={state.offerStartsAt}
                      onChangeText={(t) =>
                        setState((s) => ({ ...s, offerStartsAt: t }))
                      }
                    />
                    <FieldError message={state.errors.offerStartsAt} />
                  </View>
                  <View className="flex-1">
                    <FieldLabel>Hasta</FieldLabel>
                    <TextInput
                      className="h-11 border-b border-ink/25 pb-1 font-sans text-[14px] text-ink"
                      placeholder="2026-05-20"
                      placeholderTextColor="#6B6488"
                      value={state.offerEndsAt}
                      onChangeText={(t) =>
                        setState((s) => ({ ...s, offerEndsAt: t }))
                      }
                    />
                    <FieldError message={state.errors.offerEndsAt} />
                  </View>
                </View>
              </View>
            )}
          </View>
        )}

        {tab === 'inventario' && (
          <View className="gap-5">
            <SectionHeader
              letter="C"
              title="Inventario"
              hint="Decide si manejar stock — el producto sigue disponible si no lo manejás."
            />

            <ToggleRow
              label="Manejar stock"
              sub={
                state.tracksStock
                  ? 'Llevamos la cuenta y el catálogo lo oculta cuando se agota.'
                  : 'El producto siempre estará disponible. No se descuenta inventario.'
              }
              on={state.tracksStock}
              onChange={(v) => setState((s) => ({ ...s, tracksStock: v }))}
            />

            {state.tracksStock ? (
              <>
                <View>
                  <FieldLabel>Stock actual</FieldLabel>
                  <TextInput
                    className="h-11 border-b border-ink/25 pb-1 font-sans text-[16px] text-ink"
                    placeholder="0"
                    placeholderTextColor="#6B6488"
                    keyboardType="number-pad"
                    value={state.stockText}
                    onChangeText={(t) =>
                      setState((s) => ({ ...s, stockText: t }))
                    }
                    style={{ fontVariant: ['tabular-nums'] }}
                  />
                  <FieldError message={state.errors.stockText} />
                </View>

                {/* Stock state banner */}
                <View
                  className={`border-l-[3px] px-3 py-2.5 ${
                    stockN === 0
                      ? 'border-bad bg-bad/5'
                      : stockN <= 5
                        ? 'border-warn bg-warn/5'
                        : 'border-ok bg-ok/5'
                  }`}
                  style={{ borderLeftWidth: 3 }}
                >
                  <View className="flex-row items-center gap-2">
                    <View
                      className={`h-1.5 w-1.5 rounded-full ${
                        stockN === 0
                          ? 'bg-bad'
                          : stockN <= 5
                            ? 'bg-warn'
                            : 'bg-ok'
                      }`}
                    />
                    <Text className="font-sans text-[12px] text-ink">
                      {stockN === 0
                        ? 'Sin stock — el producto se mostrará como agotado.'
                        : stockN <= 5
                          ? `Stock bajo. Quedan ${stockN}.`
                          : `Stock saludable — ${stockN} unidades.`}
                    </Text>
                  </View>
                </View>
              </>
            ) : (
              <View
                className="border-l-[3px] border-brand bg-brand-light/40 px-3 py-2.5"
                style={{ borderLeftWidth: 3 }}
              >
                <Text className="font-sans text-[12px] text-ink">
                  Sin manejo de stock — el producto siempre va a estar
                  disponible mientras esté activo.
                </Text>
              </View>
            )}
          </View>
        )}

        {tab === 'avanzado' && (
          <View className="gap-5">
            <SectionHeader
              letter="D"
              title="Visibilidad y comisiones"
              hint="Si está disponible, qué cobra el promotor, y qué puntos gana el cliente."
            />

            <ToggleRow
              label="Disponible para clientes"
              sub={
                state.isAvailable
                  ? 'Aparece en el catálogo y se puede pedir.'
                  : 'Pausado — no aparece en el catálogo.'
              }
              on={state.isAvailable}
              onChange={(v) => setState((s) => ({ ...s, isAvailable: v }))}
            />

            <Hairline />

            <View>
              <FieldLabel>Comisión promotor (%)</FieldLabel>
              <TextInput
                className="h-11 border-b border-ink/25 pb-1 font-sans text-[16px] text-ink"
                placeholder="0"
                placeholderTextColor="#6B6488"
                keyboardType="decimal-pad"
                value={state.promoterCommissionText}
                onChangeText={(t) =>
                  setState((s) => ({ ...s, promoterCommissionText: t }))
                }
                style={{ fontVariant: ['tabular-nums'] }}
              />
              <FieldError message={state.errors.promoterCommissionText} />
              <Text className="mt-1 font-sans text-[10px] text-ink-muted">
                Lo que gana un promotor por cada venta de este producto.
              </Text>
            </View>

            <View>
              <FieldLabel>Puntos cliente (%)</FieldLabel>
              <TextInput
                className="h-11 border-b border-ink/25 pb-1 font-sans text-[16px] text-ink"
                placeholder="1"
                placeholderTextColor="#6B6488"
                keyboardType="decimal-pad"
                value={state.pointsText}
                onChangeText={(t) =>
                  setState((s) => ({ ...s, pointsText: t }))
                }
                style={{ fontVariant: ['tabular-nums'] }}
              />
              <FieldError message={state.errors.pointsText} />
              <Text className="mt-1 font-sans text-[10px] text-ink-muted">
                Devolución en puntos al cliente, sobre el precio efectivo.
              </Text>
            </View>
          </View>
        )}

        {/* Validation checklist */}
        <View className="mt-7 border border-ink/10 bg-paper-deep/40 px-4 py-3">
          <Text className="mb-2 font-sans-medium text-[9px] uppercase tracking-label text-ink-muted">
            Checklist
          </Text>
          <CheckItem ok={v.name} label="Nombre (2+ caracteres)" />
          <CheckItem ok={v.category} label="Categoría asignada" />
          <CheckItem ok={v.price} label="Precio base válido" />
          <CheckItem ok={v.stock} label="Stock inicial definido" />
          <CheckItem ok={v.offer} label="Oferta válida (si está activa)" />
        </View>
      </View>

      {/* Sticky footer */}
      <View className="flex-row items-center justify-between gap-3 border-t border-ink/10 bg-paper px-5 py-4">
        <Text className="flex-1 font-sans text-[11px] text-ink-muted">
          {allValid ? (
            <>
              <Text className="font-sans-semibold text-ok">✓</Text> Listo para guardar
            </>
          ) : (
            <>Completá los campos requeridos</>
          )}
        </Text>
        <Button variant="ghost" onPress={onDone} disabled={pending}>
          Cancelar
        </Button>
        <Button variant="accent" loading={pending} onPress={onSubmit}>
          {editing ? 'Guardar →' : 'Crear →'}
        </Button>
      </View>
    </View>
  )
}

function SectionHeader({
  letter,
  title,
  hint,
}: {
  letter: string
  title: string
  hint?: string
}) {
  return (
    <View className="flex-row items-baseline gap-3">
      <Text
        className="font-sans-italic text-[20px] text-accent-dark"
        style={{ fontVariant: ['tabular-nums'] }}
      >
        {letter}
      </Text>
      <View className="flex-1">
        <Text className="font-sans-semibold text-[15px] tracking-tight text-ink">
          {title}
        </Text>
        {hint ? (
          <Text className="mt-0.5 font-sans text-[11px] text-ink-muted">
            {hint}
          </Text>
        ) : null}
      </View>
    </View>
  )
}

function CheckItem({ ok, label }: { ok: boolean; label: string }) {
  return (
    <View className="flex-row items-center gap-2 py-1">
      <View
        className={`h-3.5 w-3.5 items-center justify-center ${
          ok ? 'bg-ok' : 'border border-ink/15'
        }`}
      >
        {ok && (
          <Text className="font-sans-semibold text-[9px] text-paper">✓</Text>
        )}
      </View>
      <Text
        className={`font-sans text-[12px] ${ok ? 'text-ink' : 'text-ink-muted'}`}
      >
        {label}
      </Text>
    </View>
  )
}

function ToggleRow({
  label,
  sub,
  on,
  onChange,
}: {
  label: string
  sub: string
  on: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <Pressable
      onPress={() => onChange(!on)}
      className={`flex-row items-center gap-3 border px-3 py-3 ${
        on
          ? 'border-brand/40 bg-brand-light/40'
          : 'border-ink/15 bg-paper'
      }`}
    >
      <View
        className={`h-5 w-9 rounded-full p-0.5 ${
          on ? 'bg-brand' : 'bg-ink/15'
        }`}
      >
        <View
          className={`h-4 w-4 rounded-full ${
            on ? 'bg-accent' : 'bg-paper'
          }`}
          style={{
            transform: [{ translateX: on ? 14 : 0 }],
          }}
        />
      </View>
      <View className="flex-1">
        <Text className="font-sans-semibold text-[13px] text-ink">{label}</Text>
        <Text className="mt-0.5 font-sans text-[11px] text-ink-muted">
          {sub}
        </Text>
      </View>
    </Pressable>
  )
}

function stockTone(stock: number): { dot: string; label: string } {
  if (stock <= 0) return { dot: 'bg-bad', label: 'Sin stock' }
  if (stock <= 5) return { dot: 'bg-warn', label: 'Stock bajo' }
  return { dot: 'bg-ok', label: 'Stock OK' }
}

function ProductRow({
  product,
  onEdit,
  onDelete,
  onToggle,
  onStock,
  updating,
}: {
  product: Product
  onEdit: () => void
  onDelete: () => void
  onToggle: () => void
  onStock: (delta: number) => void
  updating: boolean
}) {
  const tone = stockTone(product.stock)
  const placeholder = product.name.slice(0, 3).toUpperCase()
  return (
    <View className="py-5">
      {/* Top: image + identity + price */}
      <View className="flex-row gap-3">
        <View className="relative">
          <PlaceholderImage label={placeholder} size={64} />
          {product.offerActive && (
            <View className="absolute left-0 top-0 bg-accent px-1.5 py-0.5">
              <Text className="font-sans-semibold text-[8px] uppercase tracking-label text-brand-dark">
                Oferta
              </Text>
            </View>
          )}
        </View>
        <View className="flex-1 min-w-0">
          <View className="flex-row items-start justify-between gap-2">
            <Text
              className="flex-1 font-sans-semibold text-[17px] leading-[20px] text-ink"
              numberOfLines={2}
            >
              {product.name}
            </Text>
            <View className="items-end">
              {product.offerActive ? (
                <View className="flex-row items-baseline gap-1.5">
                  <Text
                    className="font-sans text-[11px] text-ink-muted line-through"
                    style={{ fontVariant: ['tabular-nums'] }}
                  >
                    {formatCents(product.basePriceCents)}
                  </Text>
                  <Text
                    className="font-sans-semibold text-[18px] text-brand"
                    style={{ fontVariant: ['tabular-nums'] }}
                  >
                    {formatCents(product.effectivePriceCents)}
                  </Text>
                </View>
              ) : (
                <Text
                  className="font-sans-semibold text-[18px] text-brand"
                  style={{ fontVariant: ['tabular-nums'] }}
                >
                  {formatCents(product.effectivePriceCents)}
                </Text>
              )}
            </View>
          </View>

          <View className="mt-1 flex-row items-center gap-2">
            {product.category && (
              <Text className="font-sans text-[11px] text-ink-muted">
                {product.category.iconEmoji ?? '·'} {product.category.name}
              </Text>
            )}
            <View className="h-0.5 w-0.5 rounded-full bg-ink/20" />
            <Text className="font-sans text-[10px] uppercase tracking-label text-ink-muted">
              Com {product.promoterCommissionPct}%
            </Text>
            <Text className="font-sans text-[10px] uppercase tracking-label text-ink-muted">
              · Pts {product.pointsPct}%
            </Text>
          </View>

          {product.description && (
            <Text
              className="mt-1 text-[12px] leading-[16px] text-ink-soft"
              numberOfLines={1}
            >
              {product.description}
            </Text>
          )}
        </View>
      </View>

      {/* Stock + visibility row */}
      <View className="mt-3 flex-row items-center justify-between border border-ink/10 bg-paper-deep/40 px-3 py-2">
        <View className="flex-row items-center gap-2.5">
          <View className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} />
          <Text
            className="font-sans-medium text-[11px] uppercase tracking-label text-ink-soft"
            style={{ fontVariant: ['tabular-nums'] }}
          >
            {tone.label} · {product.stock}
          </Text>
          <Pressable
            onPress={onToggle}
            disabled={updating}
            className={`h-6 px-2 ${product.isAvailable ? 'bg-ok/15' : 'bg-ink/15'}`}
          >
            <Text
              className={`font-sans-medium text-[10px] uppercase tracking-label leading-6 ${
                product.isAvailable ? 'text-ok' : 'text-ink-muted'
              }`}
            >
              {product.isAvailable ? 'Visible' : 'Oculto'}
            </Text>
          </Pressable>
        </View>
        <View className="flex-row gap-1">
          <Pressable
            onPress={() => onStock(-1)}
            disabled={updating || product.stock <= 0}
            className="h-7 w-7 items-center justify-center border border-ink/15 bg-paper active:bg-paper-deep"
          >
            <Text className="font-sans-semibold text-[14px] text-ink">−</Text>
          </Pressable>
          <Pressable
            onPress={() => onStock(1)}
            disabled={updating}
            className="h-7 w-7 items-center justify-center border border-ink/15 bg-paper active:bg-paper-deep"
          >
            <Text className="font-sans-semibold text-[14px] text-ink">+</Text>
          </Pressable>
        </View>
      </View>

      <View className="mt-3 flex-row gap-2">
        <View className="flex-1">
          <Button variant="outline" onPress={onEdit}>
            Editar
          </Button>
        </View>
        <Button variant="ghost" onPress={onDelete}>
          Borrar
        </Button>
      </View>

      <Hairline className="mt-5" />
    </View>
  )
}

export default function SuperProductsScreen() {
  const { data: products, isPending, refetch, isRefetching } = useAdminProducts()
  const del = useDeleteProduct()
  const updateInventory = useUpdateInventory()
  const [editing, setEditing] = useState<Product | null>(null)
  const [creating, setCreating] = useState(false)

  const available = useMemo(
    () => (products ?? []).filter((p) => p.isAvailable).length,
    [products],
  )

  const handleDelete = (product: Product) => {
    Alert.alert('Borrar producto', `¿Borrar "${product.name}"?`, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Borrar',
        style: 'destructive',
        onPress: () => del.mutate(product.id),
      },
    ])
  }

  const handleToggle = (product: Product) => {
    updateInventory.mutate({
      productId: product.id,
      isAvailable: !product.isAvailable,
    })
  }

  const handleStock = (product: Product, delta: number) => {
    const next = Math.max(0, product.stock + delta)
    updateInventory.mutate({ productId: product.id, stock: next })
  }

  if (isPending) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-paper">
        <ActivityIndicator color="#220247" size="small" />
      </SafeAreaView>
    )
  }

  const editingOrCreating = editing !== null || creating

  return (
    <SafeAreaView edges={['top']} className="flex-1 bg-paper">
      <FlatList
        data={editingOrCreating ? [] : products ?? []}
        keyExtractor={(p) => p.id}
        contentContainerClassName="px-5 pb-12"
        refreshing={isRefetching}
        onRefresh={refetch}
        ListHeaderComponent={
          <View className="pb-2 pt-6">
            <SectionHead
              eyebrow="Panel · Catálogo"
              title="Catálogo"
              italicTail="global."
              subtitle="Productos, disponibilidad y stock."
            />

            <View className="mb-7 flex-row gap-2">
              <KpiCard label="Productos" value={products?.length ?? 0} tone="idle" />
              <KpiCard label="Disponibles" value={available} tone="ok" />
              <KpiCard
                label="Sin stock"
                value={(products?.length ?? 0) - available}
                tone="warn"
              />
            </View>

            {editingOrCreating ? (
              <ProductForm
                editing={editing}
                onDone={() => {
                  setEditing(null)
                  setCreating(false)
                }}
              />
            ) : (
              <View className="mb-6">
                <Button variant="accent" onPress={() => setCreating(true)}>
                  + Nuevo producto
                </Button>
              </View>
            )}

            {!editingOrCreating && <Hairline className="mb-2" />}
          </View>
        }
        renderItem={({ item }) => (
          <ProductRow
            product={item}
            onEdit={() => {
              setEditing(item)
              setCreating(false)
            }}
            onDelete={() => handleDelete(item)}
            onToggle={() => handleToggle(item)}
            onStock={(delta) => handleStock(item, delta)}
            updating={updateInventory.isPending}
          />
        )}
        ListEmptyComponent={
          !editingOrCreating ? (
            <View className="items-center py-16">
              <Eyebrow>Sin productos</Eyebrow>
              <Text className="mt-3 text-center text-[15px] text-ink-soft">
                Creá el primer producto global.
              </Text>
            </View>
          ) : null
        }
      />
    </SafeAreaView>
  )
}
