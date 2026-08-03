import { describe, expect, it } from 'vitest'
import { isSeller, isStaff, isSuperAdmin, roleLabel } from './roles'

describe('isStaff', () => {
  it('lets the super admin and the seller into /super', () => {
    expect(isStaff('super_admin_delivery')).toBe(true)
    expect(isStaff('seller')).toBe(true)
  })

  it('keeps clients and promoters out', () => {
    expect(isStaff('client')).toBe(false)
    expect(isStaff('promoter')).toBe(false)
    expect(isStaff(undefined)).toBe(false)
    expect(isStaff(null)).toBe(false)
  })
})

describe('isSuperAdmin', () => {
  it('is NOT satisfied by a seller — the admin-only screens stay closed', () => {
    expect(isSuperAdmin('super_admin_delivery')).toBe(true)
    expect(isSuperAdmin('seller')).toBe(false)
  })
})

describe('isSeller', () => {
  it('only matches the seller role', () => {
    expect(isSeller('seller')).toBe(true)
    expect(isSeller('super_admin_delivery')).toBe(false)
    expect(isSeller('client')).toBe(false)
  })
})

describe('roleLabel', () => {
  it('names every role', () => {
    expect(roleLabel('super_admin_delivery')).toBe('Reparto')
    expect(roleLabel('seller')).toBe('Vendedor')
    expect(roleLabel('promoter')).toBe('Promotor')
    expect(roleLabel('client')).toBe('Cliente')
    expect(roleLabel(undefined)).toBe('Cliente')
  })
})
