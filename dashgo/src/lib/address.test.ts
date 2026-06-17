/**
 * Address summary helpers — the compact list summary ("Casa 24 — frente al
 * colmado") and the detail field list. Mirrors web's dashgo-web/src/lib/address.
 */
import {
  formatAddressShort,
  formatAddressLine,
  addressDetailParts,
  userAddressToGeoAddress,
} from './address'
import type { GeoAddress, UserAddress } from './types'

const base: GeoAddress = { text: 'Calle Duarte 100, Santo Domingo' }

function fakeUserAddress(overrides: Partial<UserAddress> = {}): UserAddress {
  return {
    id: 'addr-1',
    userId: 'user-1',
    label: 'Casa',
    line1: 'Calle Duarte 100',
    line2: null,
    building: null,
    lat: 18.47,
    lng: -69.9,
    instructions: null,
    isDefault: false,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  }
}

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

describe('formatAddressLine', () => {
  it('joins address, building and apto/piso with " · "', () => {
    expect(
      formatAddressLine({
        ...base,
        building: 'Edif. 4',
        unit: 'Apto 3B',
      }),
    ).toBe('Calle Duarte 100, Santo Domingo · Edif. 4 · Apto 3B')
  })

  it('shows just the address line when there is no building or unit', () => {
    expect(formatAddressLine(base)).toBe('Calle Duarte 100, Santo Domingo')
  })

  it('falls back to the house number when there is no free-text', () => {
    expect(
      formatAddressLine({ text: '', houseNumber: '24', unit: 'Apto 3B' }),
    ).toBe('Casa 24 · Apto 3B')
  })

  it('ignores whitespace-only building and unit', () => {
    expect(formatAddressLine({ ...base, building: '  ', unit: '  ' })).toBe(
      'Calle Duarte 100, Santo Domingo',
    )
  })

  it('handles a missing address', () => {
    expect(formatAddressLine(null)).toBe('Sin ubicación')
    expect(formatAddressLine({ text: '' })).toBe('Sin ubicación')
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

describe('userAddressToGeoAddress', () => {
  it('maps line1/lat/lng and omits empty optional fields', () => {
    expect(userAddressToGeoAddress(fakeUserAddress())).toEqual({
      text: 'Calle Duarte 100',
      lat: 18.47,
      lng: -69.9,
    })
  })

  it('appends line2 to text and maps building + instructions→reference', () => {
    expect(
      userAddressToGeoAddress(
        fakeUserAddress({
          line2: 'Apto 3B',
          building: 'Torre B',
          instructions: 'frente al colmado',
        }),
      ),
    ).toEqual({
      text: 'Calle Duarte 100, Apto 3B',
      lat: 18.47,
      lng: -69.9,
      building: 'Torre B',
      reference: 'frente al colmado',
    })
  })

  it('omits whitespace-only optional fields rather than sending blanks', () => {
    const result = userAddressToGeoAddress(
      fakeUserAddress({ building: '   ', instructions: '  ' }),
    )
    expect(result).not.toHaveProperty('building')
    expect(result).not.toHaveProperty('reference')
  })
})
