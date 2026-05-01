import { cart } from './cart'

beforeEach(() => {
  // Reset cart state between tests
  cart.clear()
})

describe('cart — signal pattern', () => {
  it('starts with an empty items map', () => {
    expect(cart.get().items).toEqual({})
  })

  it('adds an item and reflects the update in get()', () => {
    cart.update('product-1', 1)
    expect(cart.get().items['product-1']).toBe(1)
  })

  it('increments quantity on repeated updates', () => {
    cart.update('product-1', 1)
    cart.update('product-1', 2)
    expect(cart.get().items['product-1']).toBe(3)
  })

  it('removes an item when quantity reaches 0', () => {
    cart.update('product-1', 3)
    cart.update('product-1', -3)
    expect(cart.get().items['product-1']).toBeUndefined()
  })

  it('does not allow negative quantities — clamps to 0 and removes', () => {
    cart.update('product-1', 1)
    cart.update('product-1', -10)
    expect(cart.get().items['product-1']).toBeUndefined()
  })

  it('notifies subscribers when state changes', () => {
    const listener = jest.fn()
    const unsubscribe = cart.subscribe(listener)

    cart.update('product-2', 1)

    expect(listener).toHaveBeenCalledTimes(1)
    unsubscribe()
  })

  it('stops notifying after unsubscribe', () => {
    const listener = jest.fn()
    const unsubscribe = cart.subscribe(listener)

    unsubscribe()
    cart.update('product-3', 1)

    expect(listener).not.toHaveBeenCalled()
  })

  it('clears all items', () => {
    cart.update('product-1', 2)
    cart.update('product-2', 3)
    cart.clear()
    expect(cart.get().items).toEqual({})
  })

  it('computes total item count correctly', () => {
    cart.update('p1', 2)
    cart.update('p2', 3)
    const items = cart.get().items
    const total = Object.values(items).reduce((sum, qty) => sum + qty, 0)
    expect(total).toBe(5)
  })

  it('total reflects only remaining items after removal', () => {
    cart.update('p1', 2)
    cart.update('p2', 3)
    cart.update('p1', -2) // remove p1
    const items = cart.get().items
    const total = Object.values(items).reduce((sum, qty) => sum + qty, 0)
    expect(total).toBe(3)
    expect(items['p1']).toBeUndefined()
  })
})
