/**
 * MaintenanceBanner (mobile) tests.
 *
 * Mantenimiento automático: el sistema genera la visita solo, así que cuando el
 * bebedero tiene una visita abierta el banner deja de pedirle al cliente que la
 * solicite y le dice para qué día está programada, con un acceso a su pedido.
 * Sin visita enlazada, el banner se comporta exactamente como antes (cuenta
 * regresiva / alerta de vencido con el botón de solicitar).
 */
import React from 'react'
import { cleanup, fireEvent, render } from '@testing-library/react-native'
import { router } from 'expo-router'
import i18n from '../i18n'
import type { Rental } from '../lib/types'

jest.mock('../lib/queries', () => ({
  useMyRentals: jest.fn(),
  useProducts: jest.fn(),
  useRequestMaintenance: jest.fn(),
}))

import { useMyRentals, useProducts, useRequestMaintenance } from '../lib/queries'
import { MaintenanceBanner } from './MaintenanceBanner'

// Viernes 2 de octubre de 2026, 8:00 AM en Nueva York.
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
  ;(useMyRentals as jest.Mock).mockReturnValue({ data: rentals })
  ;(useProducts as jest.Mock).mockReturnValue({
    data: [{ id: 'p-maint', isMaintenanceService: true, isAvailable: true }],
  })
  ;(useRequestMaintenance as jest.Mock).mockReturnValue({
    mutateAsync: jest.fn(),
    isPending: false,
    isError: false,
    error: null,
  })
  return render(<MaintenanceBanner />)
}

describe('MaintenanceBanner (mobile)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.spyOn(Date, 'now').mockReturnValue(NOW.getTime())
  })
  afterEach(async () => {
    jest.restoreAllMocks()
    // Desmonta ANTES de devolver el idioma: con el banner montado, el cambio
    // de idioma dispara un re-render fuera de `act`.
    cleanup()
    await i18n.changeLanguage('es')
  })

  describe('con una visita programada por el sistema', () => {
    const scheduled = () =>
      makeRental({
        maintenanceOrderId: 'order-visit',
        maintenanceScheduledFor: '2026-10-02',
      })

    it('dice para qué día quedó programada, sin cortarlo por zona horaria', () => {
      const { getByText } = setup([scheduled()])

      expect(
        getByText(/Mantenimiento programado para el viernes 2 de octubre/i),
      ).toBeTruthy()
    })

    it('ya no muestra la alerta de vencido ni el botón de solicitar', () => {
      const { queryByText } = setup([scheduled()])

      expect(queryByText(/Mantenimiento del bebedero vencido/i)).toBeNull()
      expect(queryByText(/Solicitar mantenimiento/i)).toBeNull()
    })

    it('"Ver pedido" lleva al pedido de la visita', () => {
      const { getByText } = setup([scheduled()])

      fireEvent.press(getByText(/Ver pedido/i))

      expect(router.push).toHaveBeenCalledWith({
        pathname: '/orders/[orderId]',
        params: { orderId: 'order-visit' },
      })
    })

    it('tiene prioridad aunque el contador todavía no haya vencido (vence más tarde hoy)', () => {
      const { getByText, queryByText } = setup([
        makeRental({
          // Vence esta noche: el cron igual genera la visita a las 8:00.
          nextMaintenanceAt: '2026-10-03T02:00:00.000Z',
          maintenanceOrderId: 'order-visit',
          maintenanceScheduledFor: '2026-10-02',
        }),
      ])

      expect(getByText(/Mantenimiento programado para el/i)).toBeTruthy()
      expect(queryByText(/Próximo mantenimiento en/i)).toBeNull()
    })

    it('se traduce al inglés', async () => {
      await i18n.changeLanguage('en')

      const { getByText } = setup([scheduled()])

      expect(
        getByText(/Maintenance scheduled for Friday, October 2/i),
      ).toBeTruthy()
      expect(getByText(/View order/i)).toBeTruthy()
    })
  })

  describe('sin visita programada (comportamiento de siempre)', () => {
    it('vencido: muestra la alerta y el botón para solicitar', () => {
      const { getByText, queryByText } = setup([makeRental()])

      expect(getByText(/Mantenimiento del bebedero vencido/i)).toBeTruthy()
      expect(getByText(/Solicitar mantenimiento/i)).toBeTruthy()
      expect(queryByText(/Mantenimiento programado/i)).toBeNull()
    })

    it('al día: muestra la cuenta regresiva', () => {
      const { getByText } = setup([
        makeRental({ nextMaintenanceAt: '2026-12-01T12:00:00.000Z' }),
      ])

      expect(getByText(/Próximo mantenimiento en/i)).toBeTruthy()
    })

    it('una visita con id pero sin día asignado cae al comportamiento de siempre', () => {
      const { getByText, queryByText } = setup([
        makeRental({
          maintenanceOrderId: 'order-visit',
          maintenanceScheduledFor: null,
        }),
      ])

      expect(getByText(/Mantenimiento del bebedero vencido/i)).toBeTruthy()
      expect(queryByText(/Mantenimiento programado/i)).toBeNull()
    })

    it('sin bebederos con contador no muestra nada', () => {
      const { toJSON } = setup([makeRental({ nextMaintenanceAt: null })])

      expect(toJSON()).toBeNull()
    })
  })
})
