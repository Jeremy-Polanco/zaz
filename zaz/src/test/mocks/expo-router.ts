/**
 * Granular expo-router mock.
 * Import helpers from this file to configure per-test behavior.
 *
 * Example:
 *   import { mockRouter, mockSearchParams } from '@/test/mocks/expo-router'
 *   mockSearchParams.mockReturnValue({ success: '1' })
 */

export const mockRouter = {
  push: jest.fn(),
  back: jest.fn(),
  replace: jest.fn(),
  navigate: jest.fn(),
  dismiss: jest.fn(),
}

/**
 * Mock for useLocalSearchParams — returns {} by default.
 * Override per-test: mockSearchParams.mockReturnValueOnce({ success: '1' })
 */
export const mockSearchParams = jest.fn(() => ({}))

/**
 * Mock for useFocusEffect — calls the callback immediately by default.
 * Override per-test if you need to control when the effect fires.
 */
export const mockUseFocusEffect = jest.fn((cb: () => (() => void) | void) => {
  cb()
})

/** Reset all mocks to their defaults between tests. */
export function resetExpoRouterMocks() {
  mockRouter.push.mockReset()
  mockRouter.back.mockReset()
  mockRouter.replace.mockReset()
  mockRouter.navigate.mockReset()
  mockRouter.dismiss.mockReset()
  mockSearchParams.mockReset().mockReturnValue({})
  mockUseFocusEffect.mockReset().mockImplementation((cb) => { cb() })
}
