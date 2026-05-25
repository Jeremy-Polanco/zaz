import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SuscriptorBadge } from './SuscriptorBadge'

describe('SuscriptorBadge', () => {
  it('renders null when wasSubscriber is false', () => {
    const { container } = render(<SuscriptorBadge wasSubscriber={false} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders the badge when wasSubscriber is true', () => {
    render(<SuscriptorBadge wasSubscriber={true} />)
    expect(screen.getByText(/Suscriptor/i)).toBeInTheDocument()
  })

  it('badge has visible text content when rendered', () => {
    render(<SuscriptorBadge wasSubscriber={true} />)
    const badge = screen.getByText(/Suscriptor/i)
    expect(badge.tagName.toLowerCase()).toBe('span')
  })

  it('does not render any DOM node when wasSubscriber is false', () => {
    const { container } = render(<SuscriptorBadge wasSubscriber={false} />)
    expect(container.innerHTML).toBe('')
  })
})
