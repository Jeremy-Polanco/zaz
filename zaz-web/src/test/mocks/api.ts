import { vi } from 'vitest'

// ── Axios instance mock ────────────────────────────────────────────────────────
// Individual tests can override these with mockResolvedValueOnce / mockRejectedValueOnce.

export const mockApi = {
  get: vi.fn().mockResolvedValue({ data: {} }),
  post: vi.fn().mockResolvedValue({ data: {} }),
  patch: vi.fn().mockResolvedValue({ data: {} }),
  delete: vi.fn().mockResolvedValue({ data: {} }),
  put: vi.fn().mockResolvedValue({ data: {} }),
}

// Usage in test files:
//   vi.mock('../../lib/api', () => ({ api: mockApi, TOKEN_KEY: 'zaz.token' }))
