import { createFileRoute, Outlet, redirect } from '@tanstack/react-router'
import { TOKEN_KEY } from '../lib/api'

// Wrapper for the /direcciones section. The auth guard here is inherited by
// every child route (list, new, edit), mirroring the orders.tsx pattern.
export const Route = createFileRoute('/direcciones')({
  beforeLoad: () => {
    if (!localStorage.getItem(TOKEN_KEY)) {
      throw redirect({ to: '/login', search: { next: undefined, ref: undefined } })
    }
  },
  component: () => <Outlet />,
})
