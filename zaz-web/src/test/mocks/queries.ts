import { vi } from 'vitest'
import type { MyCreditResponse, Subscription, SubscriptionPlan, Category } from '../../lib/types'

// ── Default mock data ──────────────────────────────────────────────────────────

export const defaultMyCreditResponse: MyCreditResponse = {
  balanceCents: 0,
  creditLimitCents: 0,
  dueDate: null,
  status: 'none',
  amountOwedCents: 0,
  locked: false,
  movements: [],
}

export const defaultSubscription: Subscription = {
  id: 'sub_test_001',
  userId: 'user_test_001',
  status: 'active',
  model: 'rental',
  currentPeriodStart: '2026-01-01T00:00:00.000Z',
  currentPeriodEnd: '2026-02-01T00:00:00.000Z',
  cancelAtPeriodEnd: false,
  canceledAt: null,
  purchasedAt: null,
}

export const defaultSubscriptionPlan: SubscriptionPlan = {
  priceCents: 1000,
  currency: 'usd',
  interval: 'month',
}

export const defaultCategory: Category = {
  id: 'cat-001',
  name: 'Agua',
  slug: 'agua',
  iconEmoji: '💧',
  displayOrder: 1,
  imageUrl: null,
}

// ── Hook mock factories ────────────────────────────────────────────────────────

export function createMockUseMyCredit(overrides: Partial<MyCreditResponse> = {}) {
  return {
    data: { ...defaultMyCreditResponse, ...overrides },
    isPending: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }
}

export function createMockUseMySubscription(sub: Subscription | null | undefined = null) {
  return {
    data: sub,
    isPending: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }
}

export function createMockUseSubscriptionPlan(plan: SubscriptionPlan = defaultSubscriptionPlan) {
  return {
    data: plan,
    isPending: false,
    isError: false,
    error: null,
  }
}

export function createMockUseCategories(categories: Category[] = [defaultCategory]) {
  return {
    data: categories,
    isPending: false,
    isError: false,
    error: null,
  }
}

export function createMockUseProducts(products = []) {
  return {
    data: products,
    isPending: false,
    isError: false,
    error: null,
  }
}

export function createMockMutation() {
  return {
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    isPending: false,
    isError: false,
    isSuccess: false,
    error: null,
    reset: vi.fn(),
  }
}
