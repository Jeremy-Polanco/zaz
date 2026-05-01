import { categorySelection } from './category-selection'

beforeEach(() => {
  // Reset to null between tests
  categorySelection.set(null)
})

describe('categorySelection — pendingCategorySlug', () => {
  it('starts with pendingSlug as null', () => {
    expect(categorySelection.get().pendingSlug).toBeNull()
  })

  it('set() updates the pendingSlug', () => {
    categorySelection.set('agua')
    expect(categorySelection.get().pendingSlug).toBe('agua')
  })

  it('set(null) clears the pendingSlug', () => {
    categorySelection.set('agua')
    categorySelection.set(null)
    expect(categorySelection.get().pendingSlug).toBeNull()
  })

  it('notifies subscribers when the slug changes', () => {
    const listener = jest.fn()
    const unsubscribe = categorySelection.subscribe(listener)

    categorySelection.set('botellon')

    expect(listener).toHaveBeenCalledTimes(1)
    unsubscribe()
  })

  it('stops notifying after unsubscribe', () => {
    const listener = jest.fn()
    const unsubscribe = categorySelection.subscribe(listener)
    unsubscribe()

    categorySelection.set('otros')

    expect(listener).not.toHaveBeenCalled()
  })

  it('consume() returns the current slug and clears it', () => {
    categorySelection.set('agua')
    const slug = categorySelection.consume()
    expect(slug).toBe('agua')
    expect(categorySelection.get().pendingSlug).toBeNull()
  })

  it('consume() returns null when no pending slug', () => {
    const slug = categorySelection.consume()
    expect(slug).toBeNull()
    expect(categorySelection.get().pendingSlug).toBeNull()
  })

  it('consume() notifies subscribers when it clears a non-null slug', () => {
    categorySelection.set('agua')
    const listener = jest.fn()
    const unsubscribe = categorySelection.subscribe(listener)

    categorySelection.consume()

    expect(listener).toHaveBeenCalledTimes(1)
    unsubscribe()
  })

  it('consume() does NOT notify when already null', () => {
    const listener = jest.fn()
    const unsubscribe = categorySelection.subscribe(listener)

    categorySelection.consume() // pendingSlug is already null

    expect(listener).not.toHaveBeenCalled()
    unsubscribe()
  })
})
