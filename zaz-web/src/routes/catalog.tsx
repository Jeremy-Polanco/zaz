import { createFileRoute, isRedirect, Link, redirect, useNavigate, useSearch } from '@tanstack/react-router'
import { useMemo, useState } from 'react'
import { z } from 'zod'
import { Button } from '../components/ui'
import { useCategories, useProducts, useCurrentUser } from '../lib/queries'
import { useCart } from '../lib/cart'
import { formatCents } from '../lib/utils'
import { TOKEN_KEY, api } from '../lib/api'
import type { AuthUser, Product } from '../lib/types'

const catalogSearchSchema = z.object({
  cat: z.string().optional(),
})

export const Route = createFileRoute('/catalog')({
  validateSearch: catalogSearchSchema,
  beforeLoad: async () => {
    if (!localStorage.getItem(TOKEN_KEY))
      throw redirect({ to: '/login', search: { next: undefined, ref: undefined } })
    try {
      const { data: me } = await api.get<AuthUser>('/auth/me')
      if (me.role === 'super_admin_delivery')
        throw redirect({ to: '/super/orders' })
    } catch (e) {
      if (isRedirect(e)) throw e
      throw redirect({ to: '/login', search: { next: undefined, ref: undefined } })
    }
  },
  component: CatalogPage,
})

function CatalogPage() {
  const { data: products, isPending } = useProducts()
  const { data: categories } = useCategories()
  const { data: user } = useCurrentUser()
  const { items, totalItems, update } = useCart()
  const { cat } = useSearch({ from: '/catalog' })
  const navigate = useNavigate({ from: '/catalog' })
  const [query, setQuery] = useState('')

  if (isPending) {
    return (
      <div className="mx-auto max-w-6xl px-6 py-20 text-center">
        <span className="eyebrow">Cargando catálogo…</span>
      </div>
    )
  }

  const q = query.trim().toLowerCase()
  const firstName = user?.fullName?.split(' ')[0] ?? ''
  const neighborhood =
    user?.addressDefault?.text?.split('·').pop()?.trim() ?? 'New York'

  const filtered = (products ?? []).filter((p) => {
    if (cat && p.category?.slug !== cat) return false
    if (q !== '') {
      const name = p.name.toLowerCase()
      const desc = (p.description ?? '').toLowerCase()
      if (!name.includes(q) && !desc.includes(q)) return false
    }
    return true
  })

  const suggested = useMemo(() => {
    if (!products || q !== '') return []
    const inFilter = new Set(filtered.map((p) => p.id))
    return products
      .filter((p) => !inFilter.has(p.id) && p.isAvailable)
      .sort((a, b) => Number(b.offerActive) - Number(a.offerActive))
      .slice(0, 4)
  }, [products, filtered, q])

  const totalCents = (products ?? []).reduce((sum, p) => {
    const qty = items[p.id] ?? 0
    return sum + p.effectivePriceCents * qty
  }, 0)

  const setCat = (next: string | undefined) => {
    navigate({ search: next ? { cat: next } : {}, replace: true })
  }

  return (
    <div className="page-rise mx-auto max-w-6xl px-6 pb-32 pt-8">
      {/* Search pill + view chips */}
      <div className="sticky top-[57px] z-20 -mx-6 mb-2 border-b border-ink/10 bg-paper/95 px-6 pb-3 pt-1 backdrop-blur">
        <div className="flex items-center gap-3">
          <div className="flex h-11 flex-1 items-center gap-2 rounded-full border border-ink/15 bg-paper-deep px-4">
            <SearchIcon />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar productos…"
              className="flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-muted"
              type="search"
            />
            <button
              type="button"
              className="text-ink-muted hover:text-ink"
              title="Buscar por foto"
              aria-label="Buscar por foto"
            >
              <CameraIcon />
            </button>
            <button
              type="button"
              className="text-ink-muted hover:text-ink"
              title="Búsqueda por voz"
              aria-label="Búsqueda por voz"
            >
              <MicIcon />
            </button>
          </div>
          {totalItems > 0 ? (
            <Link to="/checkout" className="hidden sm:block">
              <Button variant="accent" size="sm">
                Checkout · {formatCents(totalCents)}
              </Button>
            </Link>
          ) : null}
        </div>

        {categories && categories.length > 0 ? (
          <div className="-mb-1 mt-3 flex gap-2 overflow-x-auto pb-2">
            <CategoryChip
              active={!cat}
              onClick={() => setCat(undefined)}
              label="Todos"
            />
            {categories.map((c) => (
              <CategoryChip
                key={c.id}
                active={cat === c.slug}
                onClick={() => setCat(c.slug)}
                label={`${c.iconEmoji ?? ''} ${c.name}`.trim()}
              />
            ))}
          </div>
        ) : null}
      </div>

      {/* Greeting / contextual strip */}
      <div className="mb-5 mt-4 flex items-end justify-between">
        <div>
          <span className="eyebrow">{neighborhood}</span>
          <p className="display mt-0.5 text-base font-semibold leading-tight text-ink">
            {q
              ? `${filtered.length} resultado${filtered.length === 1 ? '' : 's'} para "${query}"`
              : firstName
                ? `Hola, ${firstName}.`
                : 'Hola.'}
          </p>
        </div>
        <span className="nums text-xs text-ink-muted">
          {filtered.length} ítems
        </span>
      </div>

      {filtered.length > 0 ? (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {filtered.map((p) => (
            <ProductCard
              key={p.id}
              product={p}
              quantity={items[p.id] ?? 0}
              onDec={() => update(p.id, -1)}
              onInc={() => update(p.id, 1)}
            />
          ))}
        </ul>
      ) : (
        <div className="flex flex-col items-center gap-3 border border-dashed border-ink/15 px-8 py-20 text-center">
          <span className="eyebrow">
            {q ? 'Sin resultados' : 'Catálogo vacío'}
          </span>
          <p className="text-base text-ink-muted">
            {q
              ? 'Sin resultados. Prueba con otra palabra.'
              : cat
                ? 'No hay productos en esta categoría.'
                : 'No hay productos disponibles ahora mismo.'}
          </p>
        </div>
      )}

      {/* Suggested products */}
      {!q && suggested.length > 0 ? (
        <div className="mt-12">
          <h3 className="display mb-4 text-xl font-semibold tracking-tight text-ink">
            Ítems que te pueden interesar
          </h3>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {suggested.map((p) => (
              <ProductCard
                key={p.id}
                product={p}
                quantity={items[p.id] ?? 0}
                onDec={() => update(p.id, -1)}
                onInc={() => update(p.id, 1)}
              />
            ))}
          </ul>
        </div>
      ) : null}

      {/* Sticky cart bar (mobile / smaller viewports) */}
      {totalItems > 0 ? (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-ink/10 bg-ink px-4 py-3 sm:hidden">
          <div className="mx-auto flex max-w-6xl items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center bg-accent">
              <span className="nums text-sm font-bold text-brand-dark">
                {totalItems}
              </span>
            </div>
            <div className="flex flex-1 flex-col">
              <span className="text-[0.6rem] uppercase tracking-[0.14em] text-paper/55">
                En carrito
              </span>
              <span className="nums text-base font-semibold text-paper">
                {formatCents(totalCents)}
              </span>
            </div>
            <Link to="/checkout">
              <Button variant="accent" size="sm">
                Checkout →
              </Button>
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function CategoryChip({
  active,
  onClick,
  label,
}: {
  active: boolean
  onClick: () => void
  label: string
}) {
  return (
    <button
      onClick={onClick}
      className={`shrink-0 whitespace-nowrap rounded-xs border px-4 py-2 text-[0.7rem] font-semibold uppercase tracking-[0.10em] leading-none transition-colors ${
        active
          ? 'border-accent bg-accent text-brand-dark'
          : 'border-ink/15 bg-transparent text-ink-muted hover:border-ink/30 hover:text-ink'
      }`}
      type="button"
    >
      {label}
    </button>
  )
}

function ProductCard({
  product,
  quantity,
  onDec,
  onInc,
}: {
  product: Product
  quantity: number
  onDec: () => void
  onInc: () => void
}) {
  const imgSrc = product.imageUpdatedAt
    ? `${import.meta.env.VITE_API_URL}/products/${product.id}/image?t=${new Date(product.imageUpdatedAt).getTime()}`
    : null
  const placeholder = product.name.slice(0, 3).toUpperCase()

  return (
    <li className="group relative flex flex-col overflow-hidden border border-ink/15 bg-paper transition-colors hover:border-ink/30">
      <div className="relative aspect-square w-full">
        {imgSrc ? (
          <img
            src={imgSrc}
            alt={product.name}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="placeholder-img h-full w-full">{placeholder}</div>
        )}

        {product.offerActive ? (
          <span className="absolute left-1.5 top-1.5 bg-accent px-1.5 py-0.5 text-[0.55rem] font-semibold uppercase tracking-[0.12em] text-brand-dark">
            Oferta
          </span>
        ) : null}

        {quantity > 0 ? (
          <div className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-brand">
            <span className="nums text-[0.7rem] font-bold text-paper">
              {quantity}
            </span>
          </div>
        ) : null}
      </div>

      <div className="flex flex-1 flex-col gap-2 px-2.5 pb-3 pt-2.5">
        <p className="line-clamp-2 min-h-[2.4em] text-[0.8rem] font-medium leading-snug text-ink">
          {product.name}
        </p>

        <div className="flex items-baseline gap-2">
          <TypographicPrice cents={product.effectivePriceCents} />
          {product.offerActive ? (
            <span className="nums text-[0.65rem] text-ink-muted line-through">
              {formatCents(product.basePriceCents)}
            </span>
          ) : null}
        </div>

        {product.isAvailable ? (
          quantity === 0 ? (
            <button
              type="button"
              onClick={onInc}
              className="mt-1 h-8 border border-ink/40 text-[0.62rem] font-medium uppercase tracking-[0.10em] leading-none text-ink hover:bg-ink/5"
            >
              Agregar +
            </button>
          ) : (
            <div className="mt-1 flex h-8 items-center border border-ink/15">
              <button
                type="button"
                onClick={onDec}
                className="h-8 w-8 text-base font-semibold text-ink hover:bg-ink/5"
                aria-label="Restar"
              >
                −
              </button>
              <span className="nums flex-1 text-center text-sm font-semibold text-ink">
                {quantity}
              </span>
              <button
                type="button"
                onClick={onInc}
                className="h-8 w-8 text-base font-semibold text-ink hover:bg-ink/5"
                aria-label="Sumar"
              >
                +
              </button>
            </div>
          )
        ) : (
          <span className="mt-1 text-[0.62rem] uppercase tracking-[0.10em] text-ink-muted">
            Sin stock
          </span>
        )}
      </div>
    </li>
  )
}

/**
 * TypographicPrice — Amazon-style: tiny $ + large integer + superscript cents.
 */
function TypographicPrice({ cents }: { cents: number }) {
  const value = (cents / 100).toFixed(2)
  const [intPart, centPart] = value.split('.')
  return (
    <span className="nums inline-flex items-baseline">
      <span className="mr-px text-[0.7rem] font-semibold leading-none text-ink">
        $
      </span>
      <span className="text-[1.35rem] font-bold leading-none tracking-tight text-ink">
        {intPart}
      </span>
      <span className="ml-px text-[0.7rem] font-semibold text-ink relative -top-2">
        {centPart}
      </span>
    </span>
  )
}

function SearchIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      className="text-ink-muted"
      aria-hidden
    >
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4-4" strokeLinecap="round" />
    </svg>
  )
}

function CameraIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      aria-hidden
    >
      <path d="M3 8a2 2 0 0 1 2-2h2.5l1-2h7l1 2H19a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <circle cx="12" cy="13" r="3.5" />
    </svg>
  )
}

function MicIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      aria-hidden
    >
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <path d="M12 18v3" />
    </svg>
  )
}
