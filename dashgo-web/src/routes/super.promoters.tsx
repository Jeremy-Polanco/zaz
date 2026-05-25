import { createFileRoute, Outlet } from '@tanstack/react-router'

export const Route = createFileRoute('/super/promoters')({
  component: () => <Outlet />,
})
