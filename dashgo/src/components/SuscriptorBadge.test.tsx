/**
 * SuscriptorBadge component tests (ADR-5: testID-based assertions).
 *
 * Note: the component prop is `wasSubscriber` (not `wasSubscriberAtQuote`).
 * The spec refers to the same semantic concept; we test the real component API.
 */
import React from 'react'
import { render } from '@testing-library/react-native'
import { SuscriptorBadge } from './SuscriptorBadge'

describe('SuscriptorBadge', () => {
  it('returns null when wasSubscriber is false', () => {
    const { toJSON } = render(<SuscriptorBadge wasSubscriber={false} />)
    expect(toJSON()).toBeNull()
  })

  it('renders the badge when wasSubscriber is true', () => {
    const { getByText } = render(<SuscriptorBadge wasSubscriber={true} />)
    expect(getByText('Suscriptor')).toBeTruthy()
  })

  it('renders without crashing for wasSubscriber=true', () => {
    expect(() => render(<SuscriptorBadge wasSubscriber={true} />)).not.toThrow()
  })

  it('renders without crashing for wasSubscriber=false', () => {
    expect(() => render(<SuscriptorBadge wasSubscriber={false} />)).not.toThrow()
  })
})
