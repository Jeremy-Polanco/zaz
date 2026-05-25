/**
 * Granular expo-web-browser mock.
 *
 * Import these helpers to override default behavior per test:
 *   import { mockOpenAuthSessionAsync } from '@/test/mocks/expo-web-browser'
 *   mockOpenAuthSessionAsync.mockResolvedValueOnce({ type: 'success', url: '...' })
 */

export const mockOpenBrowserAsync = jest.fn().mockResolvedValue({ type: 'dismiss' })
export const mockOpenAuthSessionAsync = jest.fn().mockResolvedValue({ type: 'dismiss' })
export const mockDismissBrowser = jest.fn()

/** Reset all web-browser mocks between tests. */
export function resetWebBrowserMocks() {
  mockOpenBrowserAsync.mockReset().mockResolvedValue({ type: 'dismiss' })
  mockOpenAuthSessionAsync.mockReset().mockResolvedValue({ type: 'dismiss' })
  mockDismissBrowser.mockReset()
}
