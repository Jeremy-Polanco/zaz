import { createFileRoute, isRedirect, redirect } from '@tanstack/react-router'
import { useEffect, useMemo, useState } from 'react'
import { Button, FieldError, Input, Label, SectionHeading, Textarea } from '../components/ui'
import {
  useAdminProducts,
  useCategories,
  useCreateProduct,
  useDeleteProduct,
  useUpdateInventory,
  useUpdateProduct,
  useUploadProductImage,
  type CreateProductInput,
} from '../lib/queries'
import { formatCents } from '../lib/utils'
import type { Category, Product } from '../lib/types'
import { TOKEN_KEY, api, productImageUrl } from '../lib/api'
import type { AuthUser } from '../lib/types'

const MAX_IMAGE_BYTES = 5 * 1024 * 1024

export const Route = createFileRoute('/super/products')({
  beforeLoad: async () => {
    if (!localStorage.getItem(TOKEN_KEY)) throw redirect({ to: '/login', search: { next: undefined, ref: undefined } })
    try {
      const { data: me } = await api.get<AuthUser>('/auth/me')
      if (me.role !== 'super_admin_delivery') throw redirect({ to: '/' })
    } catch (e) {
      if (isRedirect(e)) throw e
      throw redirect({ to: '/login', search: { next: undefined, ref: undefined } })
    }
  },
  component: SuperProductsPage,
})

// Sentinel: when the operator chooses to NOT manage stock, we send this large
// number on save so the product never reads as "sin stock" in catalog/checkout.
// The real "track or not" intent is preserved client-side via FormState.tracksStock.
const UNTRACKED_STOCK = 99999

type FormState = {
  name: string
  description: string
  priceText: string
  stockText: string
  tracksStock: boolean
  isAvailable: boolean
  promoterCommissionText: string
  pointsText: string
  categoryId: string
  offerLabel: string
  offerDiscountText: string
  offerStartsAt: string
  offerEndsAt: string
  errors: {
    name?: string
    priceText?: string
    stockText?: string
    promoterCommissionText?: string
    pointsText?: string
    offerDiscountText?: string
    image?: string
  }
}

const emptyForm: FormState = {
  name: '',
  description: '',
  priceText: '',
  stockText: '',
  tracksStock: true,
  isAvailable: true,
  promoterCommissionText: '0.00',
  pointsText: '1.00',
  categoryId: '',
  offerLabel: '',
  offerDiscountText: '',
  offerStartsAt: '',
  offerEndsAt: '',
  errors: {},
}

function toDateInput(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toISOString().slice(0, 10)
}

function fromDateInput(value: string): string | null {
  if (!value.trim()) return null
  const d = new Date(`${value}T00:00:00.000Z`)
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString()
}

function ProductForm({
  editing,
  onDone,
}: {
  editing: Product | null
  onDone: () => void
}) {
  const create = useCreateProduct()
  const update = useUpdateProduct()
  const uploadImage = useUploadProductImage()
  const updateInventory = useUpdateInventory()
  const { data: categories } = useCategories()
  const [showOffer, setShowOffer] = useState<boolean>(
    editing ? editing.offerDiscountPct != null : false,
  )
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [tab, setTab] = useState<'identidad' | 'precio' | 'inventario' | 'avanzado'>('identidad')

  useEffect(() => {
    if (!imageFile) {
      setPreviewUrl(null)
      return
    }
    const url = URL.createObjectURL(imageFile)
    setPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [imageFile])

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
      promoterCommissionText: editing.promoterCommissionPct,
      pointsText: editing.pointsPct,
      categoryId: editing.categoryId ?? '',
      offerLabel: editing.offerLabel ?? '',
      offerDiscountText: editing.offerDiscountPct ?? '',
      offerStartsAt: toDateInput(editing.offerStartsAt),
      offerEndsAt: toDateInput(editing.offerEndsAt),
      errors: {},
    }
  })
  const pending = create.isPending || update.isPending || uploadImage.isPending

  const existingImageSrc =
    editing && editing.imageUpdatedAt
      ? productImageUrl(editing.id, String(new Date(editing.imageUpdatedAt).getTime()))
      : null

  const onPickImage = (file: File | null) => {
    if (!file) {
      setImageFile(null)
      setState((s) => ({ ...s, errors: { ...s.errors, image: undefined } }))
      return
    }
    if (!file.type.startsWith('image/')) {
      setState((s) => ({ ...s, errors: { ...s.errors, image: 'Debe ser una imagen' } }))
      return
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setState((s) => ({ ...s, errors: { ...s.errors, image: 'Máximo 5 MB' } }))
      return
    }
    setState((s) => ({ ...s, errors: { ...s.errors, image: undefined } }))
    setImageFile(file)
  }

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
      // Untracked → sentinel value so catalog never reports "sin stock".
      stock = UNTRACKED_STOCK
    }
    const commission = parseFloat(state.promoterCommissionText)
    if (!Number.isFinite(commission) || commission < 0 || commission > 100)
      errors.promoterCommissionText = '0 a 100'
    const points = parseFloat(state.pointsText)
    if (!Number.isFinite(points) || points < 0 || points > 100)
      errors.pointsText = '0 a 100'

    let offerDiscount: number | null = null
    if (showOffer && state.offerDiscountText.trim() !== '') {
      offerDiscount = parseFloat(state.offerDiscountText)
      if (
        !Number.isFinite(offerDiscount) ||
        offerDiscount < 0 ||
        offerDiscount > 100
      ) {
        errors.offerDiscountText = '0 a 100'
      }
    }

    if (Object.keys(errors).length > 0) {
      setState((s) => ({ ...s, errors }))
      return
    }

    const payload: CreateProductInput = {
      name: state.name.trim(),
      description: state.description.trim() || undefined,
      priceToPublic: price,
      stock,
      promoterCommissionPct: commission,
      pointsPct: points,
      categoryId: state.categoryId ? state.categoryId : null,
      offerLabel: showOffer && state.offerLabel.trim() ? state.offerLabel.trim() : null,
      offerDiscountPct: showOffer && offerDiscount != null ? offerDiscount : null,
      offerStartsAt: showOffer ? fromDateInput(state.offerStartsAt) : null,
      offerEndsAt: showOffer ? fromDateInput(state.offerEndsAt) : null,
    }

    try {
      const saved = editing
        ? await update.mutateAsync({ id: editing.id, ...payload })
        : await create.mutateAsync(payload)
      if (imageFile) {
        await uploadImage.mutateAsync({ id: saved.id, file: imageFile })
      }
      // Sync isAvailable + final stock via inventory endpoint. The main create/
      // update payload doesn't include isAvailable (DTO restriction) and stock
      // changes through tracksStock toggle need to land too.
      const needsInventorySync =
        editing == null
          ? state.isAvailable === false || stock !== (saved.stock ?? 0)
          : state.isAvailable !== editing.isAvailable ||
            stock !== (editing.stock ?? 0)
      if (needsInventorySync) {
        await updateInventory.mutateAsync({
          id: saved.id,
          isAvailable: state.isAvailable,
          stock,
        })
      }
      onDone()
    } catch (e) {
      const msg =
        (e as { response?: { data?: { message?: string } } })?.response?.data
          ?.message ?? 'No se pudo guardar'
      alert(msg)
    }
  }

  // Live preview helpers
  const priceN = parseFloat(state.priceText) || 0
  const discountN = parseFloat(state.offerDiscountText) || 0
  const offerEffective =
    showOffer && discountN > 0 ? priceN * (1 - discountN / 100) : null
  const previewLabel = state.name.slice(0, 3).toUpperCase() || '—'
  const selectedCategory = (categories ?? []).find(
    (c) => c.id === state.categoryId,
  )
  const stockN = parseInt(state.stockText, 10) || 0

  // Validation booleans (drives checklist)
  const v = {
    name: state.name.trim().length >= 2,
    category: state.categoryId !== '',
    price: priceN > 0,
    stock: state.stockText.trim() !== '',
    offer: !showOffer || (discountN > 0 && discountN <= 100),
  }
  const allValid = Object.values(v).every(Boolean)

  const tabs = [
    { id: 'identidad' as const, n: '01', label: 'Identidad' },
    { id: 'precio' as const, n: '02', label: 'Precio' },
    { id: 'inventario' as const, n: '03', label: 'Inventario' },
    { id: 'avanzado' as const, n: '04', label: 'Avanzado' },
  ]

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop */}
      <button
        type="button"
        onClick={onDone}
        disabled={pending}
        aria-label="Cerrar editor"
        className="fade-in absolute inset-0 cursor-default"
        style={{ background: 'rgba(26, 21, 48, 0.45)' }}
      />

      {/* Panel */}
      <div
        className="slide-in-right relative flex h-full w-[920px] max-w-[96vw] flex-col bg-paper"
        style={{ boxShadow: '-12px 0 40px rgba(26, 21, 48, 0.18)' }}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-ink/10 px-8 py-5">
          <div className="flex min-w-0 flex-col gap-2">
            <div className="flex items-center gap-2">
              <span className="eyebrow text-brand">
                {editing ? 'Editando' : 'Nuevo'} · Producto
              </span>
              {editing ? (
                <span className="nums text-[0.65rem] text-ink-muted">
                  {editing.id.slice(0, 8)}
                </span>
              ) : null}
            </div>
            <h2 className="display truncate text-2xl font-semibold leading-tight text-ink">
              {state.name || (
                <span className="font-normal italic text-ink-muted">
                  Sin nombre todavía
                </span>
              )}
            </h2>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <span
              className={`inline-flex items-center gap-1.5 border px-2 py-0.5 text-[0.6rem] font-medium uppercase tracking-[0.12em] ${
                v.name && v.price
                  ? 'border-ok/40 bg-ok/10 text-ok'
                  : 'border-warn/40 bg-warn/10 text-warn'
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  v.name && v.price ? 'bg-ok' : 'bg-warn'
                }`}
              />
              {v.name && v.price ? 'OK' : 'Borrador'}
            </span>
            <button
              type="button"
              onClick={onDone}
              disabled={pending}
              className="text-ink-muted hover:text-ink"
              aria-label="Cerrar"
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
              >
                <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </div>

        {/* Body: form left + preview right */}
        <div className="grid min-h-0 flex-1 grid-cols-[1fr_320px] overflow-hidden">
          {/* Left: form */}
          <div className="overflow-auto border-r border-ink/10">
            {/* Tabs */}
            <div className="sticky top-0 z-10 flex gap-6 border-b border-ink/10 bg-paper px-8">
              {tabs.map((t) => {
                const sel = tab === t.id
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setTab(t.id)}
                    className={`flex items-baseline gap-2 py-3.5 ${
                      sel
                        ? 'border-b-2 border-accent'
                        : 'border-b-2 border-transparent'
                    }`}
                  >
                    <span
                      className={`nums text-base font-semibold italic leading-none ${
                        sel ? 'text-brand' : 'text-ink-muted'
                      }`}
                    >
                      {t.n}
                    </span>
                    <span
                      className={`text-[0.78rem] font-semibold tracking-tight ${
                        sel ? 'text-ink' : 'text-ink-muted'
                      }`}
                    >
                      {t.label}
                    </span>
                  </button>
                )
              })}
            </div>

            <div className="px-8 py-7">
              {tab === 'identidad' && (
                <div className="flex flex-col gap-5">
                  <SectionHeader
                    letter="A"
                    title="Información básica"
                    hint="Lo que ve el cliente al abrir el producto."
                  />

                  <div>
                    <Label htmlFor="name">Nombre</Label>
                    <Input
                      id="name"
                      value={state.name}
                      onChange={(e) =>
                        setState((s) => ({ ...s, name: e.target.value }))
                      }
                      placeholder="Galón Planeta Azul 5 gal"
                    />
                    <FieldError message={state.errors.name} />
                  </div>

                  <div>
                    <Label htmlFor="description">Descripción</Label>
                    <Textarea
                      id="description"
                      value={state.description}
                      onChange={(e) =>
                        setState((s) => ({ ...s, description: e.target.value }))
                      }
                      placeholder="Detalles que ve el cliente…"
                    />
                  </div>

                  <div>
                    <Label htmlFor="category">Categoría</Label>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          setState((s) => ({ ...s, categoryId: '' }))
                        }
                        className={`flex items-center gap-3 border px-3 py-3 text-left ${
                          state.categoryId === ''
                            ? 'border-brand bg-brand-light text-brand'
                            : 'border-ink/15 bg-paper text-ink hover:border-ink/30'
                        }`}
                      >
                        <span className="text-xl">·</span>
                        <span className="text-sm font-semibold">Sin categoría</span>
                      </button>
                      {(categories ?? []).map((c) => {
                        const sel = state.categoryId === c.id
                        return (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() =>
                              setState((s) => ({ ...s, categoryId: c.id }))
                            }
                            className={`flex items-center gap-3 border px-3 py-3 text-left ${
                              sel
                                ? 'border-brand bg-brand-light'
                                : 'border-ink/15 bg-paper hover:border-ink/30'
                            }`}
                          >
                            <span className="text-xl">{c.iconEmoji ?? '📦'}</span>
                            <div className="flex flex-1 flex-col">
                              <span
                                className={`text-sm font-semibold ${
                                  sel ? 'text-brand' : 'text-ink'
                                }`}
                              >
                                {c.name}
                              </span>
                              <span
                                className={`text-[0.65rem] uppercase tracking-[0.10em] ${
                                  sel ? 'text-brand' : 'text-ink-muted'
                                }`}
                              >
                                /{c.slug}
                              </span>
                            </div>
                          </button>
                        )
                      })}
                    </div>
                  </div>

                  <div>
                    <Label htmlFor="image">Foto del producto</Label>
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                      <div className="relative flex aspect-square w-32 shrink-0 items-center justify-center overflow-hidden border border-ink/15 bg-paper-deep/40">
                        {previewUrl ? (
                          <img
                            src={previewUrl}
                            alt="Vista previa"
                            className="h-full w-full object-cover"
                          />
                        ) : existingImageSrc ? (
                          <img
                            src={existingImageSrc}
                            alt="Imagen actual"
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <span className="text-[0.65rem] uppercase tracking-[0.18em] text-ink-muted">
                            Sin foto
                          </span>
                        )}
                      </div>
                      <div className="flex flex-1 flex-col gap-2">
                        <input
                          id="image"
                          type="file"
                          accept="image/*"
                          onChange={(e) => onPickImage(e.target.files?.[0] ?? null)}
                          className="block w-full text-sm text-ink file:mr-3 file:border file:border-ink/20 file:bg-paper file:px-3 file:py-1.5 file:text-[0.7rem] file:uppercase file:tracking-[0.15em] file:text-ink hover:file:bg-ink/5"
                        />
                        <p className="text-[0.65rem] uppercase tracking-[0.14em] text-ink-muted">
                          JPG o PNG · máx 5 MB · se sube al guardar.
                        </p>
                        {imageFile ? (
                          <button
                            type="button"
                            className="self-start text-[0.65rem] uppercase tracking-[0.15em] text-ink-muted hover:text-ink"
                            onClick={() => onPickImage(null)}
                          >
                            Quitar selección
                          </button>
                        ) : null}
                        <FieldError message={state.errors.image} />
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {tab === 'precio' && (
                <div className="flex flex-col gap-5">
                  <SectionHeader
                    letter="B"
                    title="Precio"
                    hint="USD. El impuesto y el envío se calculan en checkout."
                  />

                  <div>
                    <Label htmlFor="price">Precio base</Label>
                    <div className="flex items-center border border-ink/15 bg-paper">
                      <span className="border-r border-ink/15 px-3 py-2.5 text-sm text-ink-muted">
                        $
                      </span>
                      <input
                        id="price"
                        type="number"
                        step="0.01"
                        min="0"
                        value={state.priceText}
                        onChange={(e) =>
                          setState((s) => ({ ...s, priceText: e.target.value }))
                        }
                        className="nums flex-1 bg-transparent px-3 py-2.5 text-sm text-ink outline-none"
                        placeholder="0.00"
                      />
                      <span className="px-3 py-2.5 text-[0.65rem] uppercase tracking-[0.10em] text-ink-muted">
                        USD
                      </span>
                    </div>
                    <FieldError message={state.errors.priceText} />
                  </div>

                  <button
                    type="button"
                    onClick={() => setShowOffer((p) => !p)}
                    className={`flex items-center gap-3 border px-4 py-3 text-left ${
                      showOffer
                        ? 'border-accent-dark bg-accent-light'
                        : 'border-ink/15 bg-paper hover:border-ink/30'
                    }`}
                  >
                    <span
                      className={`relative h-5 w-9 rounded-full transition-colors ${
                        showOffer ? 'bg-brand' : 'bg-ink/15'
                      }`}
                    >
                      <span
                        className={`absolute top-0.5 h-4 w-4 rounded-full transition-transform ${
                          showOffer ? 'translate-x-[18px] bg-accent' : 'translate-x-0.5 bg-paper'
                        }`}
                      />
                    </span>
                    <div className="flex-1">
                      <div className="text-sm font-semibold text-ink">
                        Oferta activa
                      </div>
                      <div className="text-[0.7rem] text-ink-muted">
                        {showOffer ? `Descuento ${discountN || 0}%` : 'Sin descuento'}
                      </div>
                    </div>
                  </button>

                  {showOffer ? (
                    <div className="flex flex-col gap-4">
                      <div>
                        <Label htmlFor="offerLabel">Etiqueta promocional</Label>
                        <Input
                          id="offerLabel"
                          maxLength={40}
                          value={state.offerLabel}
                          onChange={(e) =>
                            setState((s) => ({ ...s, offerLabel: e.target.value }))
                          }
                          placeholder="¡Promo lanzamiento!"
                        />
                      </div>

                      <div>
                        <Label htmlFor="offerDiscount">Descuento (%)</Label>
                        <Input
                          id="offerDiscount"
                          type="number"
                          step="0.01"
                          min="0"
                          max="100"
                          value={state.offerDiscountText}
                          onChange={(e) =>
                            setState((s) => ({
                              ...s,
                              offerDiscountText: e.target.value,
                            }))
                          }
                          className="nums"
                        />
                        <FieldError message={state.errors.offerDiscountText} />
                      </div>

                      {discountN > 0 && priceN > 0 ? (
                        <div className="border-l-[3px] border-accent-dark bg-accent-light px-3 py-2.5">
                          <p className="text-sm text-ink">
                            Estás descontando{' '}
                            <strong className="nums">
                              {discountN.toFixed(0)}%
                            </strong>
                            . Le ahorras al cliente{' '}
                            <strong className="nums">
                              ${(priceN - (offerEffective ?? priceN)).toFixed(2)}
                            </strong>
                            .
                          </p>
                        </div>
                      ) : null}

                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <Label htmlFor="offerStartsAt">Desde</Label>
                          <Input
                            id="offerStartsAt"
                            type="date"
                            value={state.offerStartsAt}
                            onChange={(e) =>
                              setState((s) => ({
                                ...s,
                                offerStartsAt: e.target.value,
                              }))
                            }
                          />
                        </div>
                        <div>
                          <Label htmlFor="offerEndsAt">Hasta</Label>
                          <Input
                            id="offerEndsAt"
                            type="date"
                            value={state.offerEndsAt}
                            onChange={(e) =>
                              setState((s) => ({
                                ...s,
                                offerEndsAt: e.target.value,
                              }))
                            }
                          />
                        </div>
                      </div>
                    </div>
                  ) : null}
                </div>
              )}

              {tab === 'inventario' && (
                <div className="flex flex-col gap-5">
                  <SectionHeader
                    letter="C"
                    title="Inventario"
                    hint="Decide si manejar stock o no — el producto siempre se podrá pedir si no lo manejás."
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
                      <div>
                        <Label htmlFor="stock">Stock actual</Label>
                        <Input
                          id="stock"
                          type="number"
                          min="0"
                          value={state.stockText}
                          onChange={(e) =>
                            setState((s) => ({ ...s, stockText: e.target.value }))
                          }
                          className="nums"
                        />
                        <FieldError message={state.errors.stockText} />
                      </div>

                      <div
                        className={`border-l-[3px] px-3 py-2.5 ${
                          stockN === 0
                            ? 'border-bad bg-bad/5'
                            : stockN <= 5
                              ? 'border-warn bg-warn/5'
                              : 'border-ok bg-ok/5'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <span
                            className={`h-1.5 w-1.5 rounded-full ${
                              stockN === 0
                                ? 'bg-bad'
                                : stockN <= 5
                                  ? 'bg-warn'
                                  : 'bg-ok'
                            }`}
                          />
                          <span className="text-sm text-ink">
                            {stockN === 0
                              ? 'Sin stock — el producto se mostrará como agotado.'
                              : stockN <= 5
                                ? `Stock bajo. Quedan ${stockN}.`
                                : `Stock saludable — ${stockN} unidades.`}
                          </span>
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="border-l-[3px] border-brand bg-brand-light/40 px-3 py-2.5">
                      <span className="text-sm text-ink">
                        Sin manejo de stock — el producto siempre va a estar
                        disponible mientras esté activo.
                      </span>
                    </div>
                  )}
                </div>
              )}

              {tab === 'avanzado' && (
                <div className="flex flex-col gap-5">
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

                  <hr className="border-ink/10" />

                  <div>
                    <Label htmlFor="promoterCommission">
                      Comisión promotor (%)
                    </Label>
                    <Input
                      id="promoterCommission"
                      type="number"
                      step="0.01"
                      min="0"
                      max="100"
                      value={state.promoterCommissionText}
                      onChange={(e) =>
                        setState((s) => ({
                          ...s,
                          promoterCommissionText: e.target.value,
                        }))
                      }
                      className="nums"
                    />
                    <FieldError message={state.errors.promoterCommissionText} />
                    <p className="mt-1 text-[0.65rem] text-ink-muted">
                      Lo que gana un promotor por cada venta de este producto.
                    </p>
                  </div>

                  <div>
                    <Label htmlFor="points">Puntos cliente (%)</Label>
                    <Input
                      id="points"
                      type="number"
                      step="0.01"
                      min="0"
                      max="100"
                      value={state.pointsText}
                      onChange={(e) =>
                        setState((s) => ({ ...s, pointsText: e.target.value }))
                      }
                      className="nums"
                    />
                    <FieldError message={state.errors.pointsText} />
                    <p className="mt-1 text-[0.65rem] text-ink-muted">
                      Devolución en puntos al cliente, sobre el precio efectivo.
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Right: live preview + summary + checklist */}
          <div className="flex flex-col gap-4 overflow-auto bg-paper-deep p-6">
            <span className="eyebrow">Vista previa</span>

            {/* Mobile catalog row preview */}
            <div>
              <div className="mb-1.5 text-[0.6rem] uppercase tracking-[0.10em] text-ink-muted">
                Catálogo · cliente
              </div>
              <div className="flex gap-3 border border-ink/15 bg-paper p-3">
                <div className="relative shrink-0">
                  {previewUrl ? (
                    <img
                      src={previewUrl}
                      alt=""
                      className="h-16 w-16 object-cover"
                    />
                  ) : existingImageSrc ? (
                    <img
                      src={existingImageSrc}
                      alt=""
                      className="h-16 w-16 object-cover"
                    />
                  ) : (
                    <div className="placeholder-img h-16 w-16">
                      {previewLabel}
                    </div>
                  )}
                  {showOffer && discountN > 0 ? (
                    <div className="absolute left-0.5 top-0.5 bg-accent px-1 py-0.5 text-[0.55rem] font-bold uppercase tracking-[0.06em] text-brand-dark">
                      Oferta
                    </div>
                  ) : null}
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <div className="truncate text-[0.78rem] font-semibold text-ink">
                    {state.name || (
                      <span className="italic text-ink-muted">Sin nombre</span>
                    )}
                  </div>
                  <div className="line-clamp-2 text-[0.65rem] leading-snug text-ink-muted">
                    {state.description || 'Sin descripción'}
                  </div>
                  <div className="mt-1 flex items-baseline gap-1.5">
                    {offerEffective !== null ? (
                      <span className="nums text-[0.6rem] text-ink-muted line-through">
                        ${priceN.toFixed(2)}
                      </span>
                    ) : null}
                    <span className="nums text-sm font-semibold text-brand">
                      ${(offerEffective ?? priceN).toFixed(2)}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Summary */}
            <div className="bg-paper p-4">
              <div className="mb-2 text-[0.6rem] uppercase tracking-[0.10em] text-ink-muted">
                Resumen
              </div>
              <SumLine
                label="Categoría"
                value={
                  selectedCategory
                    ? `${selectedCategory.iconEmoji ?? ''} ${selectedCategory.name}`.trim()
                    : '—'
                }
              />
              <SumLine
                label="Precio"
                value={priceN ? `$${(offerEffective ?? priceN).toFixed(2)}` : '—'}
                bold
              />
              {discountN > 0 && offerEffective !== null ? (
                <SumLine label="Descuento" value={`−${discountN.toFixed(0)}%`} positive />
              ) : null}
              <SumLine label="Stock" value={String(stockN)} />
              <hr className="my-2 border-ink/10" />
              <SumLine
                label="Comisión"
                value={`${state.promoterCommissionText || '0'}%`}
              />
              <SumLine
                label="Puntos"
                value={`${state.pointsText || '0'}%`}
              />
            </div>

            {/* Checklist */}
            <div className="bg-paper p-4">
              <div className="mb-2 text-[0.6rem] uppercase tracking-[0.10em] text-ink-muted">
                Checklist
              </div>
              <CheckItem ok={v.name} label="Nombre (2+ caracteres)" />
              <CheckItem ok={v.category} label="Categoría asignada" />
              <CheckItem ok={v.price} label="Precio base válido" />
              <CheckItem ok={v.stock} label="Stock definido" />
              <CheckItem ok={v.offer} label="Oferta válida (si está activa)" />
            </div>
          </div>
        </div>

        {/* Sticky footer */}
        <div className="flex items-center justify-between gap-4 border-t border-ink/10 bg-paper px-8 py-4">
          <span className="text-[0.7rem] text-ink-muted">
            {allValid ? (
              <>
                <span className="font-semibold text-ok">✓</span> Listo para guardar
              </>
            ) : (
              <>Completa los campos requeridos</>
            )}
          </span>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onDone} disabled={pending}>
              Cancelar
            </Button>
            <Button
              variant="accent"
              onClick={onSubmit}
              disabled={pending || !allValid}
            >
              {pending ? 'Guardando…' : editing ? 'Guardar →' : 'Crear →'}
            </Button>
          </div>
        </div>
      </div>
    </div>
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
    <div className="flex items-baseline gap-3">
      <span className="nums text-xl font-semibold italic leading-none text-accent-dark">
        {letter}
      </span>
      <div className="flex-1">
        <div className="text-[0.95rem] font-semibold tracking-tight text-ink">
          {title}
        </div>
        {hint ? <div className="text-[0.7rem] text-ink-muted">{hint}</div> : null}
      </div>
    </div>
  )
}

function SumLine({
  label,
  value,
  bold,
  positive,
}: {
  label: string
  value: string
  bold?: boolean
  positive?: boolean
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-0.5 text-[0.78rem]">
      <span className="text-ink-muted">{label}</span>
      <span
        className={`nums truncate text-right ${bold ? 'text-sm font-semibold text-ink' : positive ? 'text-ok' : 'text-ink'}`}
      >
        {value}
      </span>
    </div>
  )
}

function CheckItem({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2 py-1 text-[0.78rem]">
      <span
        className={`flex h-3.5 w-3.5 items-center justify-center ${
          ok ? 'bg-ok text-paper' : 'border border-ink/15'
        }`}
      >
        {ok ? <span className="text-[0.55rem] font-bold">✓</span> : null}
      </span>
      <span className={ok ? 'text-ink' : 'text-ink-muted'}>{label}</span>
    </div>
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
    <button
      type="button"
      onClick={() => onChange(!on)}
      className={`flex items-center gap-3 border px-4 py-3 text-left transition-colors ${
        on
          ? 'border-brand/40 bg-brand-light/40'
          : 'border-ink/15 bg-paper hover:border-ink/30'
      }`}
    >
      <span
        className={`relative h-5 w-9 rounded-full transition-colors ${
          on ? 'bg-brand' : 'bg-ink/15'
        }`}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full transition-transform ${
            on ? 'translate-x-[18px] bg-accent' : 'translate-x-0.5 bg-paper'
          }`}
        />
      </span>
      <div className="flex-1">
        <div className="text-sm font-semibold text-ink">{label}</div>
        <div className="text-[0.7rem] text-ink-muted">{sub}</div>
      </div>
    </button>
  )
}

function SuperProductsPage() {
  const { data: products, isPending } = useAdminProducts()
  const { data: categories } = useCategories()
  const del = useDeleteProduct()
  const updateInventory = useUpdateInventory()
  const [editing, setEditing] = useState<Product | null>(null)
  const [creating, setCreating] = useState(false)

  const categoryById = useMemo(() => {
    const map = new Map<string, Category>()
    for (const c of categories ?? []) map.set(c.id, c)
    return map
  }, [categories])

  const onDelete = (p: Product) => {
    if (!window.confirm(`¿Borrar "${p.name}"?`)) return
    del.mutate(p.id)
  }

  if (isPending) {
    return (
      <div className="mx-auto max-w-6xl px-6 py-20 text-center">
        <span className="eyebrow">Cargando…</span>
      </div>
    )
  }

  const editingOrCreating = editing !== null || creating

  return (
    <div className="page-rise mx-auto max-w-6xl px-6 py-12">
      <SectionHeading
        eyebrow="Panel · Catálogo"
        title={
          <>
            Catálogo <span className="italic text-brand">global.</span>
          </>
        }
        subtitle={`${products?.length ?? 0} producto${products?.length === 1 ? '' : 's'}.`}
        action={
          !editingOrCreating ? (
            <Button variant="accent" onClick={() => setCreating(true)}>
              + Nuevo producto
            </Button>
          ) : undefined
        }
      />

      {editingOrCreating ? (
        <ProductForm
          editing={editing}
          onDone={() => {
            setEditing(null)
            setCreating(false)
          }}
        />
      ) : null}

      <div className="flex flex-col gap-4">
        {(products ?? []).map((p) => {
          const cat = p.categoryId ? categoryById.get(p.categoryId) : null
          return (
            <div
              key={p.id}
              className="flex flex-col gap-4 border border-ink/15 bg-paper p-5 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex aspect-square w-20 shrink-0 items-center justify-center overflow-hidden border border-ink/10 bg-paper-deep/40">
                {p.imageUpdatedAt ? (
                  <img
                    src={productImageUrl(
                      p.id,
                      String(new Date(p.imageUpdatedAt).getTime()),
                    )}
                    alt={p.name}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <span className="text-[0.55rem] uppercase tracking-[0.18em] text-ink-muted">
                    Sin foto
                  </span>
                )}
              </div>
              <div className="flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="display text-lg font-semibold text-ink">{p.name}</p>
                  {p.offerActive ? (
                    <span className="bg-accent px-2 py-0.5 text-[0.6rem] uppercase tracking-[0.12em] text-brand-dark">
                      🔥 Oferta
                    </span>
                  ) : null}
                  {cat ? (
                    <span className="text-[0.65rem] uppercase tracking-[0.14em] text-ink-muted">
                      {cat.iconEmoji ?? ''} {cat.name}
                    </span>
                  ) : null}
                </div>
                <div className="mt-1 flex flex-wrap gap-4 text-[0.7rem] uppercase tracking-[0.14em] text-ink-muted">
                  <span>
                    Precio:{' '}
                    {p.offerActive ? (
                      <>
                        <span className="line-through">{formatCents(p.basePriceCents)}</span>{' '}
                        <span className="text-brand">{formatCents(p.effectivePriceCents)}</span>
                      </>
                    ) : (
                      formatCents(p.effectivePriceCents)
                    )}
                  </span>
                  <span>Stock: {p.stock}</span>
                  <span>Comisión: {parseFloat(p.promoterCommissionPct).toFixed(2)}%</span>
                  <span>Puntos: {parseFloat(p.pointsPct).toFixed(2)}%</span>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant={p.isAvailable ? 'secondary' : 'ghost'}
                  onClick={() =>
                    updateInventory.mutate({
                      id: p.id,
                      isAvailable: !p.isAvailable,
                    })
                  }
                >
                  {p.isAvailable ? 'Disponible' : 'Oculto'}
                </Button>
                <Button size="sm" variant="primary" onClick={() => setEditing(p)}>
                  Editar
                </Button>
                <Button size="sm" variant="ghost" onClick={() => onDelete(p)}>
                  Borrar
                </Button>
              </div>
            </div>
          )
        })}

        {(products ?? []).length === 0 && !editingOrCreating ? (
          <div className="flex flex-col items-center gap-4 border border-dashed border-ink/20 py-20 text-center">
            <span className="eyebrow">Sin productos</span>
            <p className="display text-2xl text-ink-muted">
              Agrega el primer producto global.
            </p>
          </div>
        ) : null}
      </div>
    </div>
  )
}
