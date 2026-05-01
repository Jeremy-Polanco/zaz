import { useMemo } from 'react'
import { createFileRoute, isRedirect, redirect, useNavigate } from '@tanstack/react-router'
import { TOKEN_KEY, api } from '../lib/api'
import type { AuthUser } from '../lib/types'
import { useCategories, useProducts } from '../lib/queries'
import { CategoryCard } from '../components/CategoryCard'

export const Route = createFileRoute('/home')({
  beforeLoad: async () => {
    if (!localStorage.getItem(TOKEN_KEY)) {
      throw redirect({ to: '/login', search: { next: undefined, ref: undefined } })
    }
    try {
      const { data: me } = await api.get<AuthUser>('/auth/me')
      if (me.role === 'super_admin_delivery') {
        throw redirect({ to: '/super/orders' })
      }
      if (me.role === 'promoter') {
        throw redirect({ to: '/catalog' })
      }
    } catch (e) {
      if (isRedirect(e)) throw e
      throw redirect({ to: '/login', search: { next: undefined, ref: undefined } })
    }
  },
  component: HomePage,
})

function HomePage() {
  const { data: categories, isPending: categoriesPending } = useCategories()
  const { data: products, isPending: productsPending } = useProducts()
  const navigate = useNavigate({ from: '/home' })

  const productCountBySlug = useMemo(() => {
    const map = new Map<string, number>()
    for (const p of products ?? []) {
      if (p.category?.slug) {
        map.set(p.category.slug, (map.get(p.category.slug) ?? 0) + 1)
      }
    }
    return map
  }, [products])

  const isPending = categoriesPending || productsPending

  if (isPending) {
    return (
      <div className="mx-auto max-w-6xl px-6 py-20 text-center">
        <span className="eyebrow">Cargando categorías…</span>
      </div>
    )
  }

  const cats = categories ?? []
  const totalCount = products?.length ?? 0

  function handleCategoryClick(slug: string | null) {
    if (slug) {
      void navigate({ to: '/catalog', search: { cat: slug } })
    } else {
      void navigate({ to: '/catalog' })
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <div className="mb-6 flex flex-col gap-1">
        <span className="eyebrow">Inicio</span>
        <h1 className="display text-4xl font-semibold text-ink">¿Qué necesitas?</h1>
        {cats.length === 0 && (
          <span className="eyebrow mt-1">(no hay categorías cargadas)</span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {cats.map((cat) => (
          <CategoryCard
            key={cat.id}
            category={cat}
            productCount={productCountBySlug.get(cat.slug) ?? 0}
            variant="category"
            onClick={() => handleCategoryClick(cat.slug)}
          />
        ))}
        <CategoryCard
          category={{ id: '__all__', name: 'Ver todo', slug: '', iconEmoji: null, displayOrder: 0 }}
          productCount={totalCount}
          variant="all"
          onClick={() => handleCategoryClick(null)}
        />
      </div>
    </div>
  )
}
