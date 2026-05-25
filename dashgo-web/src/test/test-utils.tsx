import React from 'react'
import { render, type RenderOptions, type RenderResult } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
  type AnyRoute,
} from '@tanstack/react-router'

// ── Query client factory ───────────────────────────────────────────────────────

export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  })
}

// ── renderWithProviders ────────────────────────────────────────────────────────

interface ProvidersOptions extends RenderOptions {
  queryClient?: QueryClient
}

export function renderWithProviders(
  ui: React.ReactElement,
  { queryClient, ...options }: ProvidersOptions = {},
): RenderResult {
  const client = queryClient ?? createTestQueryClient()
  function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    )
  }
  return render(ui, { wrapper: Wrapper, ...options })
}

// ── renderWithRouter ───────────────────────────────────────────────────────────
// Uses createMemoryHistory + RouterProvider so tests never import routeTree.gen.ts.
// Each test builds its own minimal routeTree.

interface RouterOptions {
  initialPath?: string
  queryClient?: QueryClient
  /**
   * Additional routes to add beside the root. If omitted, the component is
   * rendered at the root route '/'.
   */
  routes?: AnyRoute[]
}

export function renderWithRouter(
  Component: () => React.ReactNode,
  { initialPath = '/', queryClient, routes = [] }: RouterOptions = {},
): RenderResult {
  const client = queryClient ?? createTestQueryClient()

  const rootRoute = createRootRoute()
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: Component as React.FC,
  })

  const routeTree = rootRoute.addChildren([indexRoute, ...routes])

  const memoryHistory = createMemoryHistory({ initialEntries: [initialPath] })
  const router = createRouter({ routeTree, history: memoryHistory })

  return render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
}
