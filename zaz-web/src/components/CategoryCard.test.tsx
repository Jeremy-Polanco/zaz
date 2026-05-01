import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { CategoryCard } from './CategoryCard'
import type { Category } from '../lib/types'

const baseCategory: Category = {
  id: 'cat-001',
  name: 'Agua',
  slug: 'agua',
  iconEmoji: '💧',
  displayOrder: 1,
  imageUrl: null,
}

const categoryWithImage: Category = {
  ...baseCategory,
  imageUrl: 'https://example.com/agua.jpg',
}

describe('CategoryCard', () => {
  it('renders category name in the card', () => {
    render(<CategoryCard category={baseCategory} productCount={5} />)
    expect(screen.getByText('Agua')).toBeInTheDocument()
    expect(screen.getByText('5 productos')).toBeInTheDocument()
  })

  it('renders an img element with the correct src when imageUrl is present', () => {
    render(<CategoryCard category={categoryWithImage} productCount={3} />)
    // The img uses alt="" (decorative) so it has role="presentation", not "img".
    // Query by CSS class or directly find the img element.
    const imgs = document.querySelectorAll('img')
    expect(imgs.length).toBe(1)
    expect(imgs[0]).toHaveAttribute('src', 'https://example.com/agua.jpg')
  })

  it('shows emoji when no imageUrl is set', () => {
    render(<CategoryCard category={baseCategory} productCount={0} />)
    // img should not be present
    expect(document.querySelectorAll('img').length).toBe(0)
    // emoji span should be present
    expect(screen.getByText('💧')).toBeInTheDocument()
  })

  it('swaps to emoji fallback when image onError fires', () => {
    render(<CategoryCard category={categoryWithImage} productCount={2} />)
    // Image is initially shown
    const imgs = document.querySelectorAll('img')
    expect(imgs.length).toBe(1)
    const img = imgs[0]

    // Simulate image load error
    fireEvent.error(img)

    // After error, image should be gone and emoji should appear
    expect(document.querySelectorAll('img').length).toBe(0)
    expect(screen.getByText('💧')).toBeInTheDocument()
  })

  it('isSeeAll (variant="all") uses the "Ver todo" copy and brand color class', () => {
    const allCategory: Category = {
      id: '__all__',
      name: 'Ver todo',
      slug: '',
      iconEmoji: null,
      displayOrder: 0,
    }
    render(<CategoryCard category={allCategory} productCount={20} variant="all" />)
    expect(screen.getByText('Ver todo el catálogo')).toBeInTheDocument()

    // The article should have the brand accent class applied
    const article = screen.getByRole('button')
    expect(article.className).toContain('bg-accent')
  })

  it('has correct aria-label for a category card', () => {
    render(<CategoryCard category={baseCategory} productCount={5} />)
    const article = screen.getByRole('button')
    expect(article).toHaveAttribute('aria-label', 'Categoría Agua, 5 productos')
  })

  it('has correct aria-label for the see-all card', () => {
    const allCategory: Category = {
      id: '__all__',
      name: 'Ver todo',
      slug: '',
      iconEmoji: null,
      displayOrder: 0,
    }
    render(<CategoryCard category={allCategory} productCount={12} variant="all" />)
    const article = screen.getByRole('button')
    expect(article).toHaveAttribute('aria-label', 'Ver todo el catálogo, 12 productos')
  })
})
