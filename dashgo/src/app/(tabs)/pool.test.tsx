/**
 * Pool del asociado (mobile) — espejo de la `/pool` web. El saldo es opcional
 * al pagar (toggle en el checkout), así que la pantalla nunca dice que se
 * aplica solo.
 */
import React from 'react'
import { renderWithProviders } from '../../test/test-utils'

jest.mock('../../lib/queries', () => ({
  useCurrentUser: jest.fn(),
  useMyAssociateBalance: jest.fn(),
  usePoolSummary: jest.fn(),
}))

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
  useSafeAreaInsets: jest.fn(() => ({ top: 0, bottom: 0, left: 0, right: 0 })),
}))

import {
  useCurrentUser,
  useMyAssociateBalance,
  usePoolSummary,
} from '../../lib/queries'
import i18n from '../../i18n'
import PoolTab from './pool'
import type { AssociateBalance, PoolSummary, UserRole } from '../../lib/types'

const mockUseCurrentUser = useCurrentUser as jest.MockedFunction<typeof useCurrentUser>
const mockUseBalance = useMyAssociateBalance as jest.MockedFunction<typeof useMyAssociateBalance>
const mockUseSummary = usePoolSummary as jest.MockedFunction<typeof usePoolSummary>

const SUMMARY: PoolSummary = {
  quarter: '2026-Q4',
  poolCents: 12345,
  associateCount: 3,
  estimatedShareCents: 4115,
  nextDistributionAt: '2027-01-01T05:00:00.000Z',
}

function setup(role: UserRole, balance: AssociateBalance | undefined, summary?: PoolSummary) {
  mockUseCurrentUser.mockReturnValue({
    data: { id: 'u-1', role },
  } as unknown as ReturnType<typeof useCurrentUser>)
  mockUseBalance.mockReturnValue({
    data: balance,
    isPending: balance === undefined,
  } as unknown as ReturnType<typeof useMyAssociateBalance>)
  mockUseSummary.mockReturnValue({
    data: summary,
    isPending: false,
  } as unknown as ReturnType<typeof usePoolSummary>)
}

afterEach(() => jest.clearAllMocks())

describe('(tabs)/pool — asociado', () => {
  it('muestra el pool, el próximo reparto, cuántos son, su parte estimada y su saldo', () => {
    setup('associate', { balanceCents: 500, entries: [] }, SUMMARY)
    const { getByText } = renderWithProviders(<PoolTab />)

    expect(getByText('$123.45')).toBeTruthy()
    expect(getByText('Próximo reparto: 1 de enero de 2027')).toBeTruthy()
    expect(getByText('3 asociados')).toBeTruthy()
    expect(getByText('$41.15')).toBeTruthy()
    // formatCents de la app: los dólares enteros van sin decimales.
    expect(getByText('$5')).toBeTruthy()
    expect(getByText('4.º trimestre 2026')).toBeTruthy()
    expect(mockUseSummary).toHaveBeenCalledWith(true)
  })

  it('con un solo asociado dice "1 asociado"', () => {
    setup('associate', { balanceCents: 0, entries: [] }, { ...SUMMARY, associateCount: 1 })
    const { getByText } = renderWithProviders(<PoolTab />)
    expect(getByText('1 asociado')).toBeTruthy()
  })

  it('a un cliente le muestra el saldo y NO pide el resumen (la API lo rechaza con 403)', () => {
    setup('client', { balanceCents: 805, entries: [] })
    const { getByText, queryByText } = renderWithProviders(<PoolTab />)

    expect(getByText('$8.05')).toBeTruthy()
    expect(queryByText('Tu parte estimada')).toBeNull()
    expect(mockUseSummary).toHaveBeenCalledWith(false)
    expect(mockUseSummary).not.toHaveBeenCalledWith(true)
  })

  it('el historial muestra el reparto con su trimestre, el canje y la devolución', () => {
    setup(
      'associate',
      {
        balanceCents: 500,
        entries: [
          { id: 'e-1', type: 'allocation', amountCents: 1000, orderId: null, quarter: '2026-Q3', createdAt: '2026-10-01T04:00:00.000Z' },
          { id: 'e-2', type: 'redemption', amountCents: -550, orderId: 'abcdef12-0000-0000-0000-000000000000', quarter: null, createdAt: '2026-10-05T14:00:00.000Z' },
          { id: 'e-3', type: 'reversal', amountCents: 550, orderId: 'abcdef12-0000-0000-0000-000000000000', quarter: null, createdAt: '2026-10-06T14:00:00.000Z' },
        ],
      },
      SUMMARY,
    )
    const { getByText } = renderWithProviders(<PoolTab />)

    expect(getByText('Reparto 3.º trimestre 2026')).toBeTruthy()
    expect(getByText('+$10')).toBeTruthy()
    expect(getByText('Usado en un pedido')).toBeTruthy()
    expect(getByText('-$5.50')).toBeTruthy()
    expect(getByText('Devuelto por cancelación')).toBeTruthy()
    expect(getByText('+$5.50')).toBeTruthy()
  })

  it('explica que el saldo es opcional al pagar (toggle) y no se aplica solo', () => {
    setup('client', { balanceCents: 800, entries: [] })
    const { getByText, queryByText } = renderWithProviders(<PoolTab />)

    expect(
      getByText(
        'Puedes usarlo al pagar un pedido, activando «Usar mi saldo de asociado». No vence.',
      ),
    ).toBeTruthy()
    expect(queryByText(/Se aplica solo/)).toBeNull()
  })

  it('sin movimientos lo dice', () => {
    setup('client', { balanceCents: 0, entries: [] })
    const { getByText } = renderWithProviders(<PoolTab />)
    expect(getByText('Todavía no tienes movimientos.')).toBeTruthy()
  })
})

describe('(tabs)/pool — inglés', () => {
  afterEach(async () => {
    await i18n.changeLanguage('es')
  })

  it('traduce el resumen, la fecha y el copy del saldo', async () => {
    await i18n.changeLanguage('en')
    setup('associate', { balanceCents: 0, entries: [] }, SUMMARY)
    const { getByText } = renderWithProviders(<PoolTab />)

    expect(getByText('Q4 2026')).toBeTruthy()
    expect(getByText('Next distribution: January 1, 2027')).toBeTruthy()
    expect(getByText('3 associates')).toBeTruthy()
    expect(getByText('Your estimated share')).toBeTruthy()
    expect(
      getByText(
        'You can use it when paying for an order by turning on «Use my associate balance». It never expires.',
      ),
    ).toBeTruthy()
  })
})
