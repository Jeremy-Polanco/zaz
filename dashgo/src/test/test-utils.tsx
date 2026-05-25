import React from 'react'
import { render } from '@testing-library/react-native'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { RenderAPI, RenderOptions } from '@testing-library/react-native'

/**
 * Creates a fresh QueryClient for each test with retries disabled so tests
 * fail fast instead of retrying network calls.
 */
export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  })
}

type RenderWithProvidersOptions = RenderOptions & {
  queryClient?: QueryClient
}

/**
 * Renders a component wrapped in QueryClientProvider.
 * Use this for every component/screen test that exercises TanStack Query hooks.
 */
export function renderWithProviders(
  ui: React.ReactElement,
  options: RenderWithProvidersOptions = {},
): RenderAPI {
  const { queryClient = createTestQueryClient(), ...renderOptions } = options

  function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )
  }

  return render(ui, { wrapper: Wrapper, ...renderOptions })
}
