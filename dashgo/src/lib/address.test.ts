/**
 * Address summary helpers — the compact list summary ("Casa 24 — frente al
 * colmado") and the detail field list. Mirrors web's dashgo-web/src/lib/address.
 */
import { formatAddressShort, addressDetailParts } from './address'
import type { GeoAddress } from './types'

const base: GeoAddress = { text: 'Calle Duarte 100, Santo Domingo' }

describe('formatAddressShort', () => {
  it('combines house number and reference', () => {
    expect(
      formatAddressShort({ ...base, houseNumber: '24', reference: 'frente al colmado' }),
    ).toBe('Casa 24 — frente al colmado')
  })

  it('shows only the house number when there is no reference', () => {
    expect(formatAddressShort({ ...base, houseNumber: '24' })).toBe('Casa 24')
  })

  it('shows only the reference when there is no house number', () => {
    expect(formatAddressShort({ ...base, reference: 'casa amarilla' })).toBe(
      'casa amarilla',
    )
  })

  it('falls back to the free-text address when nothing structured is set', () => {
    expect(formatAddressShort(base)).toBe('Calle Duarte 100, Santo Domingo')
  })

  it('ignores whitespace-only fields', () => {
    expect(
      formatAddressShort({ ...base, houseNumber: '  ', reference: '  ' }),
    ).toBe('Calle Duarte 100, Santo Domingo')
  })

  it('handles a missing address', () => {
    expect(formatAddressShort(null)).toBe('Sin ubicación')
    expect(formatAddressShort({ text: '' })).toBe('Sin ubicación')
  })
})

describe('addressDetailParts', () => {
  it('returns only the filled fields, in reading order', () => {
    expect(
      addressDetailParts({
        ...base,
        houseNumber: '24',
        building: 'Edif. 4',
        unit: 'Apto 3B',
        reference: 'frente al colmado',
      }),
    ).toEqual([
      { label: 'N° de casa', value: '24' },
      { label: 'Edificio', value: 'Edif. 4' },
      { label: 'Apto / Piso', value: 'Apto 3B' },
      { label: 'Referencia', value: 'frente al colmado' },
    ])
  })

  it('skips empty and whitespace-only fields', () => {
    expect(
      addressDetailParts({ ...base, houseNumber: '24', building: '   ' }),
    ).toEqual([{ label: 'N° de casa', value: '24' }])
  })

  it('returns an empty list for a missing address', () => {
    expect(addressDetailParts(null)).toEqual([])
  })
})
