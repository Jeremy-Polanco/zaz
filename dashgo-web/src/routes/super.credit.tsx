import { createFileRoute, Outlet } from '@tanstack/react-router'

// Layout for the /super/credit section. Renders an <Outlet /> so the nested
// child routes (index = accounts list, $userId = per-user credit detail) can
// display. Without this Outlet the $userId page never rendered (the list was
// the parent and swallowed the child). Auth is guarded on each child route.
export const Route = createFileRoute('/super/credit')({
  component: () => <Outlet />,
})
