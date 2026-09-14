/**
 * DeliveryDayPicker — chip row for assigning an order's scheduledDeliveryDate.
 * Admin-only component (both callers — QuoteBottomSheet and the (super)
 * order detail screen — are hardcoded-Spanish admin screens), so this one is
 * hardcoded Spanish too, matching the (super)/* convention.
 */
import React from 'react'
import { fireEvent, render } from '@testing-library/react-native'
import { DeliveryDayPicker } from './DeliveryDayPicker'

describe('DeliveryDayPicker', () => {
  beforeEach(() => {
    // 2026-09-14 es lunes — fija "hoy" para que los chips sean deterministas.
    jest.useFakeTimers()
    jest.setSystemTime(new Date(2026, 8, 14, 9, 0, 0))
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('shows "Hoy", "Mañana", short weekday chips ahead, and "Sin día"', () => {
    const { getByText } = render(
      <DeliveryDayPicker value={null} onChange={jest.fn()} />,
    )
    expect(getByText('Hoy')).toBeTruthy()
    expect(getByText('Mañana')).toBeTruthy()
    // 2026-09-16 es miércoles.
    expect(getByText('mié 16')).toBeTruthy()
    expect(getByText('Sin día')).toBeTruthy()
  })

  it('calls onChange with the local iso day when "Hoy" is tapped', () => {
    const onChange = jest.fn()
    const { getByText } = render(
      <DeliveryDayPicker value={null} onChange={onChange} />,
    )
    fireEvent.press(getByText('Hoy'))
    expect(onChange).toHaveBeenCalledWith('2026-09-14')
  })

  it('calls onChange with the local iso day when "Mañana" is tapped', () => {
    const onChange = jest.fn()
    const { getByText } = render(
      <DeliveryDayPicker value={null} onChange={onChange} />,
    )
    fireEvent.press(getByText('Mañana'))
    expect(onChange).toHaveBeenCalledWith('2026-09-15')
  })

  it('calls onChange(null) when "Sin día" is tapped', () => {
    const onChange = jest.fn()
    const { getByText } = render(
      <DeliveryDayPicker value="2026-09-15" onChange={onChange} />,
    )
    fireEvent.press(getByText('Sin día'))
    expect(onChange).toHaveBeenCalledWith(null)
  })

  it('does not render dates beyond the next 14 days', () => {
    const { queryByText } = render(
      <DeliveryDayPicker value={null} onChange={jest.fn()} />,
    )
    // Día 15 (index 15, 0-based → fuera del rango de 14) cae en 2026-09-29.
    expect(queryByText('mar 29')).toBeNull()
  })
})
