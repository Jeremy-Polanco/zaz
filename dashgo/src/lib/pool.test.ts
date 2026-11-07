import { formatDistributionDate } from './pool'

describe('formatDistributionDate', () => {
  it('es: el reparto de Año Nuevo cae el 1 de enero en Nueva York', () => {
    expect(formatDistributionDate('2027-01-01T05:00:00.000Z', 'es')).toBe(
      '1 de enero de 2027',
    )
  })

  it('en: mismo día, formato inglés', () => {
    expect(formatDistributionDate('2027-01-01T05:00:00.000Z', 'en')).toBe(
      'January 1, 2027',
    )
  })

  it('fija America/New_York: a las 02:00 UTC todavía es el día anterior allá', () => {
    expect(formatDistributionDate('2027-01-01T02:00:00.000Z', 'es')).toBe(
      '31 de diciembre de 2026',
    )
  })
})
