/**
 * Granular API mock.
 * Provides jest.fn() stubs for the api axios instance methods.
 *
 * Import these helpers to control API responses per test:
 *   import { mockApiGet, mockApiPost } from '@/test/mocks/api'
 *   mockApiGet.mockResolvedValueOnce({ data: { balanceCents: 5000 } })
 */

export const mockApiGet = jest.fn().mockResolvedValue({ data: null })
export const mockApiPost = jest.fn().mockResolvedValue({ data: null })
export const mockApiPut = jest.fn().mockResolvedValue({ data: null })
export const mockApiPatch = jest.fn().mockResolvedValue({ data: null })
export const mockApiDelete = jest.fn().mockResolvedValue({ data: null })

/** The mocked api instance (matches the shape of the real `api` export). */
export const mockApi = {
  get: mockApiGet,
  post: mockApiPost,
  put: mockApiPut,
  patch: mockApiPatch,
  delete: mockApiDelete,
  interceptors: {
    request: { use: jest.fn(), eject: jest.fn() },
    response: { use: jest.fn(), eject: jest.fn() },
  },
}

/** Reset all API mocks between tests. */
export function resetApiMocks() {
  mockApiGet.mockReset().mockResolvedValue({ data: null })
  mockApiPost.mockReset().mockResolvedValue({ data: null })
  mockApiPut.mockReset().mockResolvedValue({ data: null })
  mockApiPatch.mockReset().mockResolvedValue({ data: null })
  mockApiDelete.mockReset().mockResolvedValue({ data: null })
}
