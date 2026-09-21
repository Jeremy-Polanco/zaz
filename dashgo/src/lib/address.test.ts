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

  it('appends the ZIP when postalCode is present', () => {
    expect(
      formatAddressShort({ ...base, houseNumber: '24', postalCode: '10451' }),
    ).toBe('Casa 24 · ZIP 10451')
  })

  it('does not append a ZIP suffix when postalCode is absent', () => {
    expect(formatAddressShort({ ...base, houseNumber: '24' })).toBe('Casa 24')
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

  it('appends the ZIP when postalCode is present', () => {
    expect(formatAddressLine({ ...base, postalCode: '10451' })).toBe(
      'Calle Duarte 100, Santo Domingo · ZIP 10451',
    )
  })

  it('appends the ZIP after building and unit', () => {
    expect(
      formatAddressLine({
        ...base,
        building: 'Edif. 4',
        unit: 'Apto 3B',
        postalCode: '10451',
      }),
    ).toBe('Calle Duarte 100, Santo Domingo · Edif. 4 · Apto 3B · ZIP 10451')
  })

  it('ignores a whitespace-only postalCode', () => {
    expect(formatAddressLine({ ...base, postalCode: '   ' })).toBe(
      'Calle Duarte 100, Santo Domingo',
    )
  })
})

describe('formatAddressLine — saved address (UserAddress-shaped)', () => {
  it('shows the house number as a leading segment, then line1, then the ZIP', () => {
    expect(
      formatAddressLine({ houseNumber: '24', line1: 'Calle X', postalCode: '07201' }),
    ).toBe('Casa 24 · Calle X · ZIP 07201')
  })

  it('omits the house number segment when absent', () => {
    expect(formatAddressLine({ line1: 'Calle X', postalCode: '07201' })).toBe(
      'Calle X · ZIP 07201',
    )
  })

  it('includes building and line2 between line1 and the ZIP', () => {
    expect(
      formatAddressLine({
        houseNumber: '24',
        line1: 'Calle X',
        building: 'Torre B',
        line2: 'Apto 3B',
        postalCode: '07201',
      }),
    ).toBe('Casa 24 · Calle X · Torre B · Apto 3B · ZIP 07201')
  })

  it('ignores whitespace-only fields', () => {
    expect(
      formatAddressLine({ houseNumber: '  ', line1: 'Calle X', building: '  ' }),
    ).toBe('Calle X')
  })

  it('does not disturb the unchanged GeoAddress (order snapshot) behaviour', () => {
    expect(formatAddressLine(base)).toBe('Calle Duarte 100, Santo Domingo')
  })
})

// The API auto-fills `houseNumber` from the geocoder ("1101") while `line1`
// is customer-typed and usually already starts with the number ("1101
// Elizabeth Avenue") — without this, the list/checkout would double-print it
// as "Casa 1101 · 1101 Elizabeth Avenue". Skip the "Casa <n>" segment only
// when line1's LEADING TOKEN exactly matches houseNumber (case/whitespace
// insensitive) — a prefix or a token that merely starts with the number
// (e.g. "1101-A") must still show "Casa <n>".
describe('formatAddressLine — house number de-duplication', () => {
  it('skips "Casa <n>" when line1 already leads with that exact house number', () => {
    expect(
      formatAddressLine({
        houseNumber: '1101',
        line1: '1101 Elizabeth Avenue',
        postalCode: '07201',
      }),
    ).toBe('1101 Elizabeth Avenue · ZIP 07201')
  })

  it('keeps "Casa <n>" when line1 does not start with the house number', () => {
    expect(
      formatAddressLine({ houseNumber: '24', line1: 'Elizabeth Avenue', postalCode: '07201' }),
    ).toBe('Casa 24 · Elizabeth Avenue · ZIP 07201')
  })

  it('does not match when the house number is only a prefix of a longer leading token', () => {
    expect(formatAddressLine({ houseNumber: '1101', line1: '11010 Main St' })).toBe(
      'Casa 1101 · 11010 Main St',
    )
  })

  it('does not match a leading token that merely starts with the house number (hyphen suffix)', () => {
    expect(formatAddressLine({ houseNumber: '1101', line1: '1101-A Main St' })).toBe(
      'Casa 1101 · 1101-A Main St',
    )
  })

  it('matches a hyphenated house number as a whole token', () => {
    expect(formatAddressLine({ houseNumber: '120-05', line1: '120-05 Main St' })).toBe(
      '120-05 Main St',
    )
  })

  it('matches case/whitespace-insensitively', () => {
    expect(formatAddressLine({ houseNumber: ' 12A ', line1: '12a Main St' })).toBe(
      '12a Main St',
    )
  })

  it('has nothing to de-duplicate when houseNumber is empty', () => {
    expect(formatAddressLine({ line1: '1101 Elizabeth Avenue' })).toBe(
      '1101 Elizabeth Avenue',
    )
  })
})

describe('formatAddressShort — saved address (UserAddress-shaped)', () => {
  it('shows "Casa {houseNumber}" plus the ZIP when present', () => {
    expect(
      formatAddressShort({ houseNumber: '24', line1: 'Calle X', postalCode: '07201' }),
    ).toBe('Casa 24 · ZIP 07201')
  })

  it('falls back to line1 when there is no house number', () => {
    expect(formatAddressShort({ line1: 'Calle X', postalCode: '07201' })).toBe(
      'Calle X · ZIP 07201',
    )
  })

  it('does not disturb the unchanged GeoAddress (order snapshot) behaviour', () => {
    expect(
      formatAddressShort({ ...base, houseNumber: '24', reference: 'frente al colmado' }),
    ).toBe('Casa 24 — frente al colmado')
  })
})

describe('formatAddressShort — house number de-duplication', () => {
  it('falls back to line1 (which already contains the number) instead of "Casa <n>"', () => {
    expect(
      formatAddressShort({
        houseNumber: '1101',
        line1: '1101 Elizabeth Avenue',
        postalCode: '07201',
      }),
    ).toBe('1101 Elizabeth Avenue · ZIP 07201')
  })

  it('keeps "Casa <n>" when line1 does not start with the house number', () => {
    expect(
      formatAddressShort({ houseNumber: '24', line1: 'Elizabeth Avenue', postalCode: '07201' }),
    ).toBe('Casa 24 · ZIP 07201')
  })

  it('does not match when the house number is only a prefix of a longer leading token', () => {
    expect(formatAddressShort({ houseNumber: '1101', line1: '11010 Main St' })).toBe(
      'Casa 1101',
    )
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
      houseNumber: null,
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
      houseNumber: null,
    })
  })

  it('omits whitespace-only optional fields rather than sending blanks', () => {
    const result = userAddressToGeoAddress(
      fakeUserAddress({ building: '   ', instructions: '  ' }),
    )
    expect(result).not.toHaveProperty('building')
    expect(result).not.toHaveProperty('reference')
  })

  it('copies postalCode onto the mapped GeoAddress', () => {
    const result = userAddressToGeoAddress(
      fakeUserAddress({ postalCode: '10451' }),
    )
    expect(result.postalCode).toBe('10451')
  })

  it('omits postalCode when the saved address has none', () => {
    const result = userAddressToGeoAddress(fakeUserAddress({ postalCode: null }))
    expect(result).not.toHaveProperty('postalCode')
  })

  it('carries houseNumber onto the mapped GeoAddress', () => {
    const result = userAddressToGeoAddress(fakeUserAddress({ houseNumber: '24' }))
    expect(result.houseNumber).toBe('24')
  })

  it('emits houseNumber as null (not omitted) when the saved address has none', () => {
    const result = userAddressToGeoAddress(fakeUserAddress())
    expect(result.houseNumber).toBeNull()
    expect(result).toHaveProperty('houseNumber')
  })

  it('emits houseNumber as null when it is explicitly null', () => {
    const result = userAddressToGeoAddress(fakeUserAddress({ houseNumber: null }))
    expect(result.houseNumber).toBeNull()
  })

  it('treats a whitespace-only houseNumber as null', () => {
    const result = userAddressToGeoAddress(fakeUserAddress({ houseNumber: '   ' }))
    expect(result.houseNumber).toBeNull()
  })
})
