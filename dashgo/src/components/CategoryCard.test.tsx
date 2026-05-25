/**
 * CategoryCard component tests (ADR-5: testID + accessibilityLabel, NOT className).
 *
 * CategoryCard does not accept testID directly — we assert via text content
 * and accessible element presence. For the image/emoji fallback we use
 * fireEvent to trigger the onError handler.
 */
import React from 'react'
import { render, fireEvent } from '@testing-library/react-native'
import { CategoryCard } from './CategoryCard'
import type { Category } from '../lib/types'

// Mocking the api module so API_URL resolution does not throw
jest.mock('../lib/api', () => ({
  API_URL: 'http://localhost:3000',
  api: { get: jest.fn(), post: jest.fn(), interceptors: { request: { use: jest.fn() }, response: { use: jest.fn() } } },
}))

const mockCategory: Category = {
  id: 'cat-1',
  name: 'Agua',
  slug: 'agua',
  iconEmoji: '💧',
  displayOrder: 1,
  imageUrl: '/images/agua.jpg',
}

const mockCategoryNoImage: Category = {
  id: 'cat-2',
  name: 'Botellon',
  slug: 'botellon',
  iconEmoji: '🍶',
  displayOrder: 2,
  imageUrl: null,
}

describe('CategoryCard', () => {
  it('renders the category name', () => {
    const { getByText } = render(
      <CategoryCard category={mockCategory} productCount={5} />,
    )
    expect(getByText('Agua')).toBeTruthy()
  })

  it('renders the product count', () => {
    const { getByText } = render(
      <CategoryCard category={mockCategory} productCount={5} />,
    )
    expect(getByText('5 productos')).toBeTruthy()
  })

  it('shows emoji fallback when category has no imageUrl', () => {
    const { getByText } = render(
      <CategoryCard category={mockCategoryNoImage} productCount={3} />,
    )
    // Emoji should be visible since there is no image
    expect(getByText('🍶')).toBeTruthy()
  })

  it('shows emoji fallback after image load error', () => {
    const { UNSAFE_getByType, getByText } = render(
      <CategoryCard category={mockCategory} productCount={5} />,
    )
    // The Image component from expo-image (mocked to RN Image) should fire onError
    // triggering showImage=false and revealing the emoji
    const { Image } = require('react-native')
    const imageEl = UNSAFE_getByType(Image)
    fireEvent(imageEl, 'error')
    // After error, emoji should be visible
    expect(getByText('💧')).toBeTruthy()
  })

  it('renders "Ver todo el catálogo" for variant=all', () => {
    const { getByText } = render(
      <CategoryCard category={mockCategoryNoImage} productCount={10} variant="all" />,
    )
    expect(getByText('Ver todo el catálogo')).toBeTruthy()
  })

  it('renders the shopping bag emoji for variant=all', () => {
    const { getByText } = render(
      <CategoryCard category={mockCategoryNoImage} productCount={10} variant="all" />,
    )
    expect(getByText('🛍️')).toBeTruthy()
  })

  it('calls onPress when pressed', () => {
    const onPress = jest.fn()
    const { getByText } = render(
      <CategoryCard category={mockCategory} productCount={5} onPress={onPress} />,
    )
    fireEvent.press(getByText('Agua'))
    expect(onPress).toHaveBeenCalledTimes(1)
  })

  it('renders without crashing for a valid category prop', () => {
    expect(() =>
      render(<CategoryCard category={mockCategory} productCount={0} />),
    ).not.toThrow()
  })
})
