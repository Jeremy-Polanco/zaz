import {
  createRootRoute,
  Link,
  Outlet,
  useRouter,
  useRouterState,
} from '@tanstack/react-router'
import { TanStackRouterDevtools } from '@tanstack/react-router-devtools'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import { useEffect, useRef } from 'react'
import { useCurrentUser, useLogout } from '../lib/auth'
import { useUpdateMe } from '../lib/queries'
import { requestBrowserLocation, reverseGeocode } from '../lib/geo'
import { Button, ZazMark } from '../components/ui'

const LOCKOUT_ALLOWLIST = new Set<string>(['/credit/pay', '/login'])

function useCreditLockoutGate() {
  const { data: user } = useCurrentUser()
  const router = useRouter()
  const pathname = useRouterState({ select: (s) => s.location.pathname })

  useEffect(() => {
    if (!user?.creditLocked) return
    if (LOCKOUT_ALLOWLIST.has(pathname)) return
    router.navigate({ to: '/credit/pay' })
  }, [user?.creditLocked, pathname, router])
}

function RootErrorComponent({ error }: { error: Error }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-paper px-6 text-center">
      <span className="eyebrow text-bad">Error</span>
      <h1 className="display text-4xl font-semibold text-ink">Algo salió mal</h1>
      {import.meta.env.DEV && (
        <p className="max-w-md rounded-xs border border-bad/30 bg-bad/5 px-4 py-3 text-sm font-mono text-bad">
          {error.message}
        </p>
      )}
      <Link to="/">
        <Button variant="secondary">Volver al inicio</Button>
      </Link>
    </div>
  )
}

function RootNotFoundComponent() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-paper px-6 text-center">
      <span className="eyebrow text-ink-muted">404</span>
      <h1 className="display text-4xl font-semibold text-ink">Página no encontrada</h1>
      <p className="max-w-sm text-base text-ink-muted">
        Esta página no existe o fue movida.
      </p>
      <Link to="/">
        <Button variant="secondary">Volver al inicio</Button>
      </Link>
    </div>
  )
}

const navLinkClass =
  'text-[0.7rem] font-medium uppercase tracking-[0.18em] text-ink-muted transition-colors hover:text-ink [&.active]:text-ink [&.active]:underline [&.active]:underline-offset-8 [&.active]:decoration-accent [&.active]:decoration-2'

function RoleNav({ role }: { role: string }) {
  if (role === 'super_admin_delivery') {
    return (
      <nav className="hidden items-center gap-6 md:flex">
        <Link to="/super/orders" className={navLinkClass}>
          Ruta
        </Link>
        <Link to="/super/products" className={navLinkClass}>
          Productos
        </Link>
        <Link to="/super/categories" className={navLinkClass}>
          Categorías
        </Link>
        <Link to="/super/promoters" className={navLinkClass}>
          Promotores
        </Link>
        <Link
          to="/super/credit"
          search={{ status: undefined, search: undefined, page: 1, pageSize: 50 }}
          className={navLinkClass}
        >
          Crédito
        </Link>
      </nav>
    )
  }
  if (role === 'promoter') {
    return (
      <nav className="hidden items-center gap-6 md:flex">
        <Link to="/promoter" className={navLinkClass}>
          Mi panel
        </Link>
        <Link to="/catalog" className={navLinkClass}>
          Catálogo
        </Link>
        <Link to="/orders" className={navLinkClass}>
          Mis pedidos
        </Link>
        <Link to="/points" className={navLinkClass}>
          Mis puntos
        </Link>
      </nav>
    )
  }
  return (
    <nav className="hidden items-center gap-6 md:flex">
      <Link to="/catalog" className={navLinkClass}>
        Catálogo
      </Link>
      <Link to="/orders" className={navLinkClass}>
        Mis pedidos
      </Link>
      <Link to="/points" className={navLinkClass}>
        Mis puntos
      </Link>
      <Link to="/credit" className={navLinkClass}>
        Crédito
      </Link>
      <Link to="/subscription" className={navLinkClass}>
        Suscripción
      </Link>
    </nav>
  )
}

function ROLE_LABEL(role: string) {
  if (role === 'super_admin_delivery') return 'Reparto'
  if (role === 'promoter') return 'Promotor'
  return 'Cliente'
}

function NavUser() {
  const { data: user } = useCurrentUser()
  const logout = useLogout()
  const router = useRouter()

  if (!user) {
    return (
      <div className="flex items-center gap-5">
        <Link to="/login" search={{ next: undefined, ref: undefined }} className={navLinkClass}>
          Entrar
        </Link>
        <Link to="/login" search={{ next: undefined, ref: undefined }}>
          <Button size="sm" variant="accent">
            Crear cuenta
          </Button>
        </Link>
      </div>
    )
  }

  const handleLogout = () => {
    logout()
    router.navigate({ to: '/login', search: { next: undefined, ref: undefined } })
  }

  return (
    <div className="flex items-center gap-6">
      <RoleNav role={user.role} />
      <div className="hidden h-8 w-px bg-ink/15 md:block" />
      <div className="hidden flex-col text-right sm:flex">
        <span className="text-sm font-medium text-ink leading-tight">
          {user.fullName}
        </span>
        <span className="eyebrow !text-[0.6rem]">{ROLE_LABEL(user.role)}</span>
      </div>
      <Button size="sm" variant="ghost" onClick={handleLogout}>
        Salir
      </Button>
    </div>
  )
}

const LOCATION_ASK_KEY = 'zaz.locationAsked'

function useBootstrapLocation() {
  const { data: user } = useCurrentUser()
  const updateMe = useUpdateMe()
  const attempted = useRef(false)

  useEffect(() => {
    if (!user) return
    if (attempted.current) return
    if (user.addressDefault?.lat && user.addressDefault?.lng) return
    if (typeof window === 'undefined') return
    if (sessionStorage.getItem(LOCATION_ASK_KEY)) return

    attempted.current = true
    sessionStorage.setItem(LOCATION_ASK_KEY, '1')

    requestBrowserLocation()
      .then(async (coords) => {
        let text = `${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}`
        try {
          const rev = await reverseGeocode(coords.lat, coords.lng)
          text = rev.text
        } catch {
          // silent
        }
        updateMe.mutate({
          addressDefault: { text, lat: coords.lat, lng: coords.lng },
        })
      })
      .catch(() => {
        // user denied or unavailable — silent
      })
  }, [user, updateMe])
}

export const Route = createRootRoute({
  component: RootLayout,
  errorComponent: RootErrorComponent,
  notFoundComponent: RootNotFoundComponent,
})

function RootLayout() {
  useBootstrapLocation()
  useCreditLockoutGate()
  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-40 border-b border-ink/10 bg-paper/85 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-6 py-4">
          <Link to="/" className="group flex items-center gap-3">
            <span className="text-ink">
              <ZazMark size={22} />
            </span>
            <span className="hidden h-1.5 w-1.5 rounded-full bg-accent sm:block" />
            <span className="eyebrow hidden sm:block">
              Agua · New York
            </span>
          </Link>
          <NavUser />
        </div>
      </header>
      <main className="flex-1">
        <Outlet />
      </main>
      <footer className="border-t border-ink/10 bg-paper/60 py-6">
        <div className="mx-auto flex max-w-7xl flex-col items-start justify-between gap-2 px-6 sm:flex-row sm:items-center">
          <span className="eyebrow">© Zaz · El colmado, al timbre</span>
          <span className="eyebrow">New York City · ES / EN</span>
        </div>
      </footer>
      {import.meta.env.DEV && <TanStackRouterDevtools position="bottom-right" />}
      {import.meta.env.DEV && <ReactQueryDevtools buttonPosition="bottom-left" />}
    </div>
  )
}
