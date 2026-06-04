import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import {
  MutationCache,
  QueryCache,
  QueryClient,
  QueryClientProvider,
} from '@tanstack/react-query'
import { RouterProvider, createRouter } from '@tanstack/react-router'
import * as Sentry from '@sentry/react'
import axios from 'axios'
import { routeTree } from './routeTree.gen'
import { notifyNetworkError } from './components/NetworkBanner'
import './index.css'

/**
 * Detect axios-reported network failures (DNS/connection refused/CORS/etc.)
 * so we can surface a friendly "Sin conexión" toast instead of the generic
 * "Algo salió mal" message.
 */
function isNetworkError(err: unknown): boolean {
  if (!axios.isAxiosError(err)) return false
  return err.code === 'ERR_NETWORK'
}

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
    onError: (err) => {
      if (isNetworkError(err)) {
        notifyNetworkError()
        return
      }
      console.error('[query]', err)
    },
  }),
  mutationCache: new MutationCache({
    onError: (err) => {
      if (isNetworkError(err)) {
        notifyNetworkError()
        return
      }
      console.error('[mutation]', err)
    },
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
