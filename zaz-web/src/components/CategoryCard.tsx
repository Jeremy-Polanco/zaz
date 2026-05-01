import { useState } from 'react'
import type { Category } from '../lib/types'

type Props = {
  category: Category
  productCount: number
  variant?: 'category' | 'all'
  onClick?: () => void
}

export function CategoryCard({ category, productCount, variant = 'category', onClick }: Props) {
  const [showImage, setShowImage] = useState(true)
  const isAll = variant === 'all'
  const imageUrl = !isAll && category.imageUrl && showImage ? category.imageUrl : null

  return (
    <article
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onClick?.() }}
      aria-label={
        isAll
          ? `Ver todo el catálogo, ${productCount} productos`
          : `Categoría ${category.name}, ${productCount} productos`
      }
      className={`relative aspect-square cursor-pointer overflow-hidden border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
        isAll
          ? 'border-accent bg-accent text-brand-dark'
          : 'border-ink/15 bg-paper-deep hover:border-ink'
      }`}
    >
      {/* Background image */}
      {imageUrl ? (
        <img
          src={imageUrl}
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
          onError={() => setShowImage(false)}
        />
      ) : null}

      {/* Emoji centered (shown when no image) */}
      {!imageUrl ? (
        <div className="flex h-full w-full items-center justify-center">
          <span className="text-7xl" aria-hidden="true">
            {isAll ? '🛍️' : (category.iconEmoji ?? '📦')}
          </span>
        </div>
      ) : null}

      {/* Bottom overlay */}
      <div
        className={`absolute bottom-0 left-0 right-0 px-3 pb-3 pt-8 ${
          imageUrl ? 'bg-gradient-to-t from-black/60 to-transparent' : ''
        }`}
      >
        <p
          className={`eyebrow text-[0.68rem] ${
            isAll || imageUrl ? 'text-paper/80' : 'text-ink-muted'
          }`}
        >
          {productCount} productos
        </p>
        <p
          className={`display mt-0.5 text-[0.9rem] font-semibold leading-tight ${
            isAll || imageUrl ? 'text-paper' : 'text-ink'
          }`}
        >
          {isAll ? 'Ver todo el catálogo' : category.name}
        </p>
      </div>
    </article>
  )
}
