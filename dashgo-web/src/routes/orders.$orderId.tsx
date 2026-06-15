import { createFileRoute, Outlet, redirect } from '@tanstack/react-router'
import { TOKEN_KEY } from '../lib/api'

// Layout route for a single order. Renders its children (the order detail
// index and the invoice) through <Outlet />. Without this outlet the nested
// /orders/$orderId/invoice route had nowhere to render — the URL changed but
// nothing appeared. The detail content lives in orders.$orderId.index.tsx.
export const Route = createFileRoute('/orders/$orderId')({
  beforeLoad: () => {
    if (!localStorage.getItem(TOKEN_KEY))
      throw redirect({ to: '/login', search: { next: undefined, ref: undefined } })
  },
  component: () => <Outlet />,
})
