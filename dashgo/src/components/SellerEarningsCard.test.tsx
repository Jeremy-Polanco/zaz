import { render, screen } from '@testing-library/react-native'
import { SellerEarningsCard } from './SellerEarningsCard'
import type { SellerEarnings } from '../lib/types'

const zero = () => ({ pendingCents: 0, claimableCents: 0, paidCents: 0 })

function mk(o: Partial<SellerEarnings> = {}): SellerEarnings {
  return {
    sellerId: 's-1',
    pendingCents: 0,
    claimableCents: 0,
    paidCents: 0,
    byPaymentMethod: { card: zero(), cash: zero(), unknown: zero() },
    ...o,
  }
}

describe('SellerEarningsCard', () => {
  it('muestra los tres totales', () => {
    render(
      <SellerEarningsCard
        earnings={mk({
          claimableCents: 1000,
          pendingCents: 500,
          paidCents: 250,
        })}
      />,
    )
    // formatMoney deja los dólares enteros limpios ("$10"), y solo muestra
    // centavos cuando los hay. Es la convención del repo, no un bug.
    expect(screen.getByText('$10')).toBeTruthy()
    expect(screen.getByText('$5')).toBeTruthy()
    expect(screen.getByText('$2.50')).toBeTruthy()
  })

  it('separa tarjeta y efectivo — el dato que evita pagar de más', () => {
    render(
      <SellerEarningsCard
        earnings={mk({
          claimableCents: 1000,
          byPaymentMethod: {
            card: { ...zero(), claimableCents: 300 },
            cash: { ...zero(), claimableCents: 700 },
            unknown: zero(),
          },
        })}
      />,
    )
    expect(screen.getByText('Por tarjeta')).toBeTruthy()
    expect(screen.getByText('En efectivo')).toBeTruthy()
    expect(screen.getByText('$3')).toBeTruthy()
    expect(screen.getByText('$7')).toBeTruthy()
  })

  it('no muestra filas de métodos sin plata', () => {
    render(
      <SellerEarningsCard
        earnings={mk({
          claimableCents: 300,
          byPaymentMethod: {
            card: { ...zero(), claimableCents: 300 },
            cash: zero(),
            unknown: zero(),
          },
        })}
      />,
    )
    expect(screen.getByText('Por tarjeta')).toBeTruthy()
    expect(screen.queryByText('En efectivo')).toBeNull()
    expect(screen.queryByText('Sin registrar')).toBeNull()
  })

  it('las comisiones viejas sin método se muestran aparte, no como efectivo', () => {
    render(
      <SellerEarningsCard
        earnings={mk({
          claimableCents: 400,
          byPaymentMethod: {
            card: zero(),
            cash: zero(),
            unknown: { ...zero(), claimableCents: 400 },
          },
        })}
      />,
    )
    expect(screen.getByText('Sin registrar')).toBeTruthy()
    expect(screen.queryByText('En efectivo')).toBeNull()
  })

  it('sin comisiones no muestra el desglose', () => {
    render(<SellerEarningsCard earnings={mk()} />)
    expect(screen.queryByText('Cómo pagó el cliente')).toBeNull()
  })
})
