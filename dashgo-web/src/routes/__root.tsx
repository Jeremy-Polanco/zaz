import {
  createRootRoute,
  Link,
  Outlet,
  useRouter,
  useRouterState,
} from '@tanstack/react-router'
import { TanStackRouterDevtools } from '@tanstack/react-router-devtools'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useCurrentUser, useLogout } from '../lib/auth'
import { useUpdateMe } from '../lib/queries'
import { requestBrowserLocation, reverseGeocode } from '../lib/geo'
import { Button, UdashMark } from '../components/ui'
import { NetworkBanner } from '../components/NetworkBanner'
import { MaintenanceBanner } from '../components/MaintenanceBanner'
import { LocationSelector } from '../components/LocationSelector'

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

// Bigger tap targets for the mobile sheet — full-width rows, no tiny uppercase.
const mobileLinkClass =
  'block rounded-xs px-3 py-3 text-base font-medium text-ink-muted transition-colors hover:bg-ink/5 hover:text-ink [&.active]:bg-ink/5 [&.active]:text-ink'

// Role → nav links, rendered as literal <Link>s so TanStack Router keeps its
// type-safe `to`/`search`. Shared by the desktop nav and the mobile sheet; the
// caller decides the layout (className) and whether a tap should close a menu.
function RoleNavLinks({
  role,
  linkClass,
  onNavigate,
}: {
  role: string
  linkClass: string
  onNavigate?: () => void
}) {
  if (role === 'super_admin_delivery') {
    return (
      <>
        <Link to="/super/orders" className={linkClass} onClick={onNavigate}>
          Ruta
        </Link>
        <Link to="/super/products" className={linkClass} onClick={onNavigate}>
          Productos
        </Link>
        <Link to="/super/categories" className={linkClass} onClick={onNavigate}>
          Categorías
        </Link>
        <Link to="/super/promoters" className={linkClass} onClick={onNavigate}>
          Promotores
        </Link>
        <Link to="/super/users" className={linkClass} onClick={onNavigate}>
          Usuarios
        </Link>
        <Link
          to="/super/credit"
          search={{ status: undefined, search: undefined, page: 1, pageSize: 50 }}
          className={linkClass}
          onClick={onNavigate}
        >
          Crédito
        </Link>
        <Link to="/super/subscription" className={linkClass} onClick={onNavigate}>
          Suscripción
        </Link>
        <Link to="/super/rentals" className={linkClass} onClick={onNavigate}>
          Alquileres
        </Link>
        <Link to="/super/notifications" className={linkClass} onClick={onNavigate}>
          Notificar
        </Link>
        <Link to="/cuenta" className={linkClass} onClick={onNavigate}>
          Mi cuenta
        </Link>
      </>
    )
  }
  if (role === 'promoter') {
    return (
      <>
        <Link to="/promoter" className={linkClass} onClick={onNavigate}>
          Mi panel
        </Link>
        <Link to="/catalog" className={linkClass} onClick={onNavigate}>
          Catálogo
        </Link>
        <Link to="/orders" className={linkClass} onClick={onNavigate}>
          Mis pedidos
        </Link>
        <Link to="/points" className={linkClass} onClick={onNavigate}>
          Mis puntos
        </Link>
        <Link to="/cuenta" className={linkClass} onClick={onNavigate}>
          Mi cuenta
        </Link>
      </>
    )
  }
  return (
    <>
      <Link to="/catalog" className={linkClass} onClick={onNavigate}>
        Catálogo
      </Link>
      <Link to="/orders" className={linkClass} onClick={onNavigate}>
        Mis pedidos
      </Link>
      <Link to="/points" className={linkClass} onClick={onNavigate}>
        Mis puntos
      </Link>
      <Link to="/credit" className={linkClass} onClick={onNavigate}>
        Crédito
      </Link>
      <Link to="/subscription" className={linkClass} onClick={onNavigate}>
        Suscripción
      </Link>
      <Link to="/cuenta" className={linkClass} onClick={onNavigate}>
        Mi cuenta
      </Link>
    </>
  )
}

function RoleNav({ role }: { role: string }) {
  return (
    <nav className="hidden items-center gap-6 md:flex">
      <RoleNavLinks role={role} linkClass={navLinkClass} />
    </nav>
  )
}

function MenuIcon() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  )
}

function CloseIcon() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <line x1="6" y1="6" x2="18" y2="18" />
      <line x1="18" y1="6" x2="6" y2="18" />
    </svg>
  )
}

// Mobile-only nav. The header is `backdrop-blur-md`, and a backdrop-filter makes
// the element a containing block for `position: fixed` descendants — so a fixed
// overlay rendered *inside* the header would be trapped in the bar. We portal the
// overlay to <body> so it covers the real viewport. Only rendered for signed-in
// users; signed-out folks keep the visible Entrar / Crear cuenta CTAs.
function MobileNav({
  role,
  fullName,
  onLogout,
}: {
  role: string
  fullName: string
  onLogout: () => void
}) {
  const [open, setOpen] = useState(false)
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const close = () => setOpen(false)

  // Close on navigation — including programmatic redirects (lockout gate, back
  // button) that never touch a link's onClick. Resetting during render is the
  // React-recommended pattern over a setState-in-effect.
  const [menuPath, setMenuPath] = useState(pathname)
  if (pathname !== menuPath) {
    setMenuPath(pathname)
    setOpen(false)
  }

  // Lock body scroll while the sheet is open.
  useEffect(() => {
    if (!open || typeof document === 'undefined') return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [open])

  return (
    <div className="md:hidden">
      <button
        type="button"
        aria-label="Abrir menú"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-10 w-10 items-center justify-center rounded-xs border border-ink/15 text-ink transition-colors hover:bg-ink/5"
      >
        <MenuIcon />
      </button>

      {open &&
        typeof document !== 'undefined' &&
        createPortal(
          <div className="fixed inset-0 z-50 md:hidden">
            <button
              type="button"
              aria-label="Cerrar menú"
              onClick={close}
              className="absolute inset-0 bg-ink/40 backdrop-blur-sm"
            />
            <div className="absolute inset-x-0 top-0 max-h-[85vh] overflow-y-auto border-b border-ink/10 bg-paper shadow-paper">
              <div className="mx-auto max-w-7xl px-6 py-4">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex flex-col">
                    <span className="text-sm font-medium leading-tight text-ink">
                      {fullName}
                    </span>
                    <span className="eyebrow !text-[0.6rem]">
                      {ROLE_LABEL(role)}
                    </span>
                  </div>
                  <button
                    type="button"
                    aria-label="Cerrar menú"
                    onClick={close}
                    className="inline-flex h-10 w-10 items-center justify-center rounded-xs border border-ink/15 text-ink transition-colors hover:bg-ink/5"
                  >
                    <CloseIcon />
                  </button>
                </div>
                <nav className="mt-4 flex flex-col gap-1 border-t border-ink/10 pt-4">
                  <RoleNavLinks
                    role={role}
                    linkClass={mobileLinkClass}
                    onNavigate={close}
                  />
                </nav>
                <button
                  type="button"
                  onClick={() => {
                    close()
                    onLogout()
                  }}
                  className="mt-4 w-full rounded-xs border border-ink/15 px-3 py-3 text-left text-base font-medium text-ink transition-colors hover:bg-ink/5"
                >
                  Salir
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
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
    <div className="flex items-center gap-4 md:gap-6">
      <RoleNav role={user.role} />
      <LocationSelector />
      <div className="hidden h-8 w-px bg-ink/15 md:block" />
      <div className="hidden flex-col text-right sm:flex">
        <span className="text-sm font-medium text-ink leading-tight">
          {user.fullName}
        </span>
        <span className="eyebrow !text-[0.6rem]">{ROLE_LABEL(user.role)}</span>
      </div>
      <Button
        size="sm"
        variant="ghost"
        onClick={handleLogout}
        className="hidden md:inline-flex"
      >
        Salir
      </Button>
      <MobileNav
        role={user.role}
        fullName={user.fullName}
        onLogout={handleLogout}
      />
    </div>
  )
}

const LOCATION_ASK_KEY = 'dashgo.locationAsked'

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
  const { data: user } = useCurrentUser()
  return (
    <div className="flex min-h-full flex-col">
      <NetworkBanner />
      <header className="sticky top-0 z-40 border-b border-ink/10 bg-paper/85 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-6 py-4">
          <Link to="/" className="group flex items-center gap-3">
            <span className="text-ink">
              <UdashMark size={22} />
            </span>
            <span className="hidden h-1.5 w-1.5 rounded-full bg-accent sm:block" />
            <span className="eyebrow hidden sm:block">
              Agua · New Jersey
            </span>
          </Link>
          <NavUser />
        </div>
      </header>
      {user?.role === 'client' && <MaintenanceBanner />}
      <main className="flex-1">
        <Outlet />
      </main>
      <footer className="border-t border-ink/10 bg-paper/60 py-6">
        <div className="mx-auto flex max-w-7xl flex-col items-start justify-between gap-2 px-6 sm:flex-row sm:items-center">
          <span className="eyebrow">© Udash · El colmado, al timbre</span>
          <div className="flex items-center gap-4">
            <Link to="/privacidad" className="eyebrow underline">
              Privacidad
            </Link>
            <span className="eyebrow">New Jersey · ES / EN</span>
          </div>
        </div>
      </footer>
      {import.meta.env.DEV && <TanStackRouterDevtools position="bottom-right" />}
      {import.meta.env.DEV && <ReactQueryDevtools buttonPosition="bottom-left" />}
    </div>
  )
}
