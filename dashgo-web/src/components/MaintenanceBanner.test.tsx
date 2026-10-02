import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import type { Rental } from '../lib/types'

/**
 * MaintenanceBanner (web).
 *
 * Mantenimiento automático: el sistema genera la visita solo, así que cuando el
 * bebedero tiene una visita abierta el banner deja de pedirle al cliente que la
 * solicite y le dice para qué día está programada, con un acceso a su pedido.
 * Sin visita enlazada, el banner se comporta exactamente como antes (cuenta
 * regresiva / alerta de vencido con el botón de solicitar).
 */

const navigate = vi.fn()

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigate,
}))
vi.mock('../lib/queries', () => ({
  useMyRentals: vi.fn(),
  useProducts: vi.fn(),
  useRequestMaintenance: vi.fn(),
}))

import { useMyRentals, useProducts, useRequestMaintenance } from '../lib/queries'
import { MaintenanceBanner } from './MaintenanceBanner'

// Viernes 2 de octubre de 2026, 8:00 AM en Nueva York. Se fija sólo `Date`: los
// timers reales siguen corriendo y el render no se cuelga.
const NOW = new Date('2026-10-02T12:00:00Z')

function makeRental(overrides: Partial<Rental> = {}): Rental {
  return {
    id: 'r-1',
    productId: 'p-bebedero',
    productName: 'Bebedero',
    productImageUrl: null,
    monthlyRentCents: 0,
    status: 'active',
    nextChargeAt: null,
    activatedAt: '2026-07-01T00:00:00.000Z',
    // Venció ayer.
    nextMaintenanceAt: '2026-10-01T12:00:00.000Z',
    lastMaintenanceAt: null,
    maintenanceOrderId: null,
    maintenanceScheduledFor: null,
    ...overrides,
  }
}

function setup(rentals: Rental[]) {
  vi.mocked(useMyRentals).mockReturnValue({
    data: rentals,
  } as unknown as ReturnType<typeof useMyRentals>)
  vi.mocked(useProducts).mockReturnValue({
    data: [{ id: 'p-maint', isMaintenanceService: true, isAvailable: true }],
  } as unknown as ReturnType<typeof useProducts>)
  vi.mocked(useRequestMaintenance).mockReturnValue({
    mutateAsync: vi.fn(),
    isPending: false,
    isError: false,
    error: null,
  } as unknown as ReturnType<typeof useRequestMaintenance>)
  return render(<MaintenanceBanner />)
}

describe('MaintenanceBanner (web)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  describe('con una visita programada por el sistema', () => {
    const scheduled = () =>
      makeRental({
        maintenanceOrderId: 'order-visit',
        maintenanceScheduledFor: '2026-10-02',
      })

    it('dice para qué día quedó programada, sin cortarlo por zona horaria', () => {
      setup([scheduled()])

      expect(
        screen.getByText(/Mantenimiento programado para el viernes 2 de octubre/i),
      ).toBeInTheDocument()
    })

    it('ya no muestra la alerta de vencido ni el botón de solicitar', () => {
      setup([scheduled()])

      expect(
        screen.queryByText(/Mantenimiento del bebedero vencido/i),
      ).not.toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: /Solicitar mantenimiento/i }),
      ).not.toBeInTheDocument()
    })

    it('"Ver pedido" lleva al pedido de la visita', () => {
      setup([scheduled()])

      fireEvent.click(screen.getByRole('button', { name: /Ver pedido/i }))

      expect(navigate).toHaveBeenCalledWith({
        to: '/orders/$orderId',
        params: { orderId: 'order-visit' },
      })
    })

    it('tiene prioridad aunque el contador todavía no haya vencido (vence más tarde hoy)', () => {
      setup([
        makeRental({
          // Vence esta noche: el cron igual genera la visita a las 8:00.
          nextMaintenanceAt: '2026-10-03T02:00:00.000Z',
          maintenanceOrderId: 'order-visit',
          maintenanceScheduledFor: '2026-10-02',
        }),
      ])

      expect(
        screen.getByText(/Mantenimiento programado para el/i),
      ).toBeInTheDocument()
      expect(
        screen.queryByText(/Próximo mantenimiento en/i),
      ).not.toBeInTheDocument()
    })

    it('es calmo: no usa el estilo de alerta roja', () => {
      const { container } = setup([scheduled()])

      expect(container.querySelector('.border-bad')).toBeNull()
    })
  })

  describe('sin visita programada (comportamiento de siempre)', () => {
    it('vencido: muestra la alerta y el botón para solicitar', () => {
      setup([makeRental()])

      expect(
        screen.getByText(/Mantenimiento del bebedero vencido/i),
      ).toBeInTheDocument()
      expect(
        screen.getByRole('button', { name: /Solicitar mantenimiento/i }),
      ).toBeInTheDocument()
      expect(screen.queryByText(/Mantenimiento programado/i)).not.toBeInTheDocument()
    })

    it('al día: muestra la cuenta regresiva', () => {
      setup([makeRental({ nextMaintenanceAt: '2026-12-01T12:00:00.000Z' })])

      expect(screen.getByText(/Próximo mantenimiento en/i)).toBeInTheDocument()
    })

    it('una visita con id pero sin día asignado cae al comportamiento de siempre', () => {
      setup([
        makeRental({
          maintenanceOrderId: 'order-visit',
          maintenanceScheduledFor: null,
        }),
      ])

      expect(
        screen.getByText(/Mantenimiento del bebedero vencido/i),
      ).toBeInTheDocument()
      expect(screen.queryByText(/Mantenimiento programado/i)).not.toBeInTheDocument()
    })

    it('sin bebederos con contador no muestra nada', () => {
      const { container } = setup([makeRental({ nextMaintenanceAt: null })])

      expect(container).toBeEmptyDOMElement()
    })
  })
})
