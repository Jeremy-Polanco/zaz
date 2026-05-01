/**
 * Granular expo-secure-store mock.
 *
 * Import these helpers to override default behavior per test:
 *   import { mockGetItemAsync } from '@/test/mocks/expo-secure-store'
 *   mockGetItemAsync.mockResolvedValueOnce('my-token')
 */

export const mockGetItemAsync = jest.fn().mockResolvedValue(null)
export const mockSetItemAsync = jest.fn().mockResolvedValue(undefined)
export const mockDeleteItemAsync = jest.fn().mockResolvedValue(undefined)

/** Reset all secure-store mocks between tests. */
export function resetSecureStoreMocks() {
  mockGetItemAsync.mockReset().mockResolvedValue(null)
  mockSetItemAsync.mockReset().mockResolvedValue(undefined)
  mockDeleteItemAsync.mockReset().mockResolvedValue(undefined)
}
