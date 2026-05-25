import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider, createRouter } from '@tanstack/react-router'
import * as Sentry from '@sentry/react'
import { routeTree } from './routeTree.gen'
import './index.css'

// ── Sentry — initialized first so it captures bootstrap errors too. ─────────
// No-op when VITE_SENTRY_DSN is unset (local dev or preview deploys).
if (import.meta.env.VITE_SENTRY_DSN) {
  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN as string,
    environment: import.meta.env.MODE,
    tracesSampleRate: parseFloat(
      (import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE as string | undefined) ??
        '0.1',
    ),
    // Replay disabled by default to keep bundle lean; enable per-environment
    // by adding the integration if you need it later.
  })
}

// ── Global error reporters ──────────────────────────────────────────────────
window.addEventListener('unhandledrejection', (ev) => {
  console.error('Unhandled promise rejection:', ev.reason)
})
window.addEventListener('error', (ev) => {
  console.error('Uncaught error:', ev.error)
})

const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (err) => console.error('[query]', err),
  }),
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: 0,
    },
  },
})

const router = createRouter({
  routeTree,
  defaultPreload: 'intent',
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
)
