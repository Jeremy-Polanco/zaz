import { describe, expect, it } from 'vitest'
import { effectivePriceCentsFor, showsSubscriberTeaser } from './pricing'

const p = (effectivePriceCents: number, subscriberPriceCents: number | null) => ({
  effectivePriceCents,
  subscriberPriceCents,
})

describe('effectivePriceCentsFor', () => {
  it('subscriber with a subscriber price pays it', () => {
    expect(effectivePriceCentsFor(p(1000, 750), true)).toBe(750)
  })

  it('non-subscriber ignores the subscriber price', () => {
    expect(effectivePriceCentsFor(p(1000, 750), false)).toBe(1000)
  })

  it('subscriber without a subscriber price pays the catalog/offer price', () => {
    expect(effectivePriceCentsFor(p(800, null), true)).toBe(800)
  })

  it('a subscriber price of 0 is honoured (free), not treated as unset', () => {
    expect(effectivePriceCentsFor(p(1000, 0), true)).toBe(0)
  })

  it('an undefined subscriber price (older API payload) falls back safely', () => {
    expect(
      effectivePriceCentsFor({ effectivePriceCents: 1000 } as never, true),
    ).toBe(1000)
  })

  it('a cheaper offer wins — a subscriber never pays more than the public', () => {
    // effectivePriceCents=400 is a 60%-off offer, below the 750 subscriber
    // price. The subscriber price is a FLOOR, not a fixed price.
    expect(effectivePriceCentsFor(p(400, 750), true)).toBe(400)
  })

  it('ties go to the public price', () => {
    expect(effectivePriceCentsFor(p(750, 750), true)).toBe(750)
  })
})

describe('showsSubscriberTeaser', () => {
  it('shows the hook to a non-subscriber when the subscriber price is lower', () => {
    expect(showsSubscriberTeaser(p(1000, 750), false)).toBe(true)
  })

  it('does NOT show the hook to an actual subscriber', () => {
    expect(showsSubscriberTeaser(p(1000, 750), true)).toBe(false)
  })

  it('does NOT show the hook when there is no subscriber price', () => {
    expect(showsSubscriberTeaser(p(1000, null), false)).toBe(false)
  })

  it('does NOT show the hook when the subscriber price is not actually cheaper', () => {
    expect(showsSubscriberTeaser(p(1000, 1000), false)).toBe(false)
    expect(showsSubscriberTeaser(p(400, 750), false)).toBe(false)
  })
})
