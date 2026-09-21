import { describe, it, expect } from 'vitest'
import {
  formatAddressShort,
  formatAddressLine,
  addressDetailParts,
  userAddressToGeoAddress,
  formatResolvedPlace,
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

  it('appends the ZIP when present', () => {
    expect(
      formatAddressShort({
        ...base,
        houseNumber: '24',
        reference: 'frente al colmado',
        postalCode: '10451',
      }),
    ).toBe('Casa 24 — frente al colmado · ZIP 10451')
  })

  it('appends the ZIP to the free-text fallback', () => {
    expect(formatAddressShort({ ...base, postalCode: '10451' })).toBe(
      'Calle Duarte 100, Santo Domingo · ZIP 10451',
    )
  })

  it('does not append a ZIP to "Sin ubicación"', () => {
    expect(formatAddressShort({ text: '', postalCode: '10451' })).toBe(
      'Sin ubicación',
    )
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

  it('appends the ZIP even with no building or unit', () => {
    expect(formatAddressLine({ ...base, postalCode: '10451' })).toBe(
      'Calle Duarte 100, Santo Domingo · ZIP 10451',
    )
  })

  it('does not append a ZIP to "Sin ubicación"', () => {
    expect(formatAddressLine({ text: '', postalCode: '10451' })).toBe(
      'Sin ubicación',
    )
  })

  it('falls back to the house number when there is no free-text', () => {
    expect(
      formatAddressLine({ text: '', houseNumber: '24', unit: 'Apto 3B' }),
    ).toBe('Casa 24 · Apto 3B')
  })

  it('ignores whitespace-only building and unit', () => {
    expect(
      formatAddressLine({ ...base, building: '  ', unit: '  ' }),
    ).toBe('Calle Duarte 100, Santo Domingo')
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

  it('includes the ZIP when present, after Apto/Piso and before Referencia', () => {
    expect(
      addressDetailParts({
        ...base,
        houseNumber: '24',
        unit: 'Apto 3B',
        postalCode: '10451',
        reference: 'frente al colmado',
      }),
    ).toEqual([
      { label: 'N° de casa', value: '24' },
      { label: 'Apto / Piso', value: 'Apto 3B' },
      { label: 'ZIP', value: '10451' },
      { label: 'Referencia', value: 'frente al colmado' },
    ])
  })

  it('omits ZIP when absent', () => {
    expect(addressDetailParts({ ...base, houseNumber: '24' })).toEqual([
      { label: 'N° de casa', value: '24' },
    ])
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
      houseNumber: null,
      building: 'Torre B',
      reference: 'frente al colmado',
    })
  })

  it('carries houseNumber (trimmed) into the order snapshot when present', () => {
    const result = userAddressToGeoAddress(
      fakeUserAddress({ houseNumber: '1101' }),
    )
    expect(result).toMatchObject({ houseNumber: '1101' })
  })

  it('emits houseNumber as null (not omitted) when blank or absent', () => {
    expect(userAddressToGeoAddress(fakeUserAddress())).toMatchObject({
      houseNumber: null,
    })
    expect(
      userAddressToGeoAddress(fakeUserAddress({ houseNumber: '   ' })),
    ).toMatchObject({ houseNumber: null })
  })

  it('omits whitespace-only optional fields rather than sending blanks', () => {
    const result = userAddressToGeoAddress(
      fakeUserAddress({ building: '   ', instructions: '  ' }),
    )
    expect(result).not.toHaveProperty('building')
    expect(result).not.toHaveProperty('reference')
  })

  it('copies postalCode when present', () => {
    const result = userAddressToGeoAddress(
      fakeUserAddress({ postalCode: '10451' }),
    )
    expect(result).toMatchObject({ postalCode: '10451' })
  })

  it('omits postalCode when null or absent', () => {
    const result = userAddressToGeoAddress(fakeUserAddress({ postalCode: null }))
    expect(result).not.toHaveProperty('postalCode')
  })
})

// A saved address (UserAddress) must format through the same helpers an order
// snapshot (GeoAddress) uses — house number first, then the street, building
// and unit, then the ZIP. This keeps SavedAddressesList and the order views
// visually consistent instead of maintaining a second ad-hoc formatter.
describe('formatAddressLine — saved address (UserAddress) input', () => {
  it('shows the house number first, then line1, then the ZIP', () => {
    expect(
      formatAddressLine(
        fakeUserAddress({
          houseNumber: '24',
          line1: 'Calle Duarte 100',
          postalCode: '07201',
        }),
      ),
    ).toBe('Casa 24 · Calle Duarte 100 · ZIP 07201')
  })

  it('maps building and line2 (Apto/Piso) the same as a GeoAddress unit', () => {
    expect(
      formatAddressLine(
        fakeUserAddress({
          building: 'Torre B',
          line2: 'Apto 3B',
        }),
      ),
    ).toBe('Calle Duarte 100 · Torre B · Apto 3B')
  })

  it('falls back to just the house number when line1 is unset', () => {
    expect(
      formatAddressLine(fakeUserAddress({ line1: '', houseNumber: '24' })),
    ).toBe('Casa 24')
  })

  it('omits the house number segment when absent', () => {
    expect(formatAddressLine(fakeUserAddress())).toBe('Calle Duarte 100')
  })

  // Reviewer finding: the API now auto-fills `houseNumber` from the geocoder
  // while `line1` is free text that usually already starts with the number
  // ("1101 Elizabeth Avenue"), which was rendering "Casa 1101 · 1101
  // Elizabeth Avenue" — the house number twice.
  it('skips the house number segment when line1 already begins with it (whole token)', () => {
    expect(
      formatAddressLine(
        fakeUserAddress({
          houseNumber: '1101',
          line1: '1101 Elizabeth Avenue',
          postalCode: '07201',
        }),
      ),
    ).toBe('1101 Elizabeth Avenue · ZIP 07201')
  })

  it('matches the house number prefix case/whitespace-insensitively', () => {
    expect(
      formatAddressLine(
        fakeUserAddress({ houseNumber: '24b', line1: '24B Main St' }),
      ),
    ).toBe('24B Main St')
  })

  it('keeps the house number segment when line1 only shares a numeric prefix, not a whole token', () => {
    expect(
      formatAddressLine(
        fakeUserAddress({ houseNumber: '1101', line1: '11010 Main St' }),
      ),
    ).toBe('Casa 1101 · 11010 Main St')
  })

  it('keeps the house number segment when a hyphen extends the token ("1101-A" vs "1101")', () => {
    expect(
      formatAddressLine(
        fakeUserAddress({ houseNumber: '1101', line1: '1101-A Main St' }),
      ),
    ).toBe('Casa 1101 · 1101-A Main St')
  })

  it('skips the house number segment for a hyphenated house number matching as a whole token', () => {
    expect(
      formatAddressLine(
        fakeUserAddress({ houseNumber: '120-05', line1: '120-05 41st Avenue' }),
      ),
    ).toBe('120-05 41st Avenue')
  })

  it('keeps the normal "Casa <n>" behavior when houseNumber is empty', () => {
    expect(
      formatAddressLine(fakeUserAddress({ houseNumber: '', line1: '1101 Elizabeth Avenue' })),
    ).toBe('1101 Elizabeth Avenue')
  })
})

describe('formatAddressShort — saved address (UserAddress) input', () => {
  it('combines house number and the instructions field (mapped to reference)', () => {
    expect(
      formatAddressShort(
        fakeUserAddress({ houseNumber: '24', instructions: 'frente al colmado' }),
      ),
    ).toBe('Casa 24 — frente al colmado')
  })

  it('falls back to line1 when there is no house number or instructions', () => {
    expect(formatAddressShort(fakeUserAddress())).toBe('Calle Duarte 100')
  })
})

describe('formatResolvedPlace', () => {
  it('joins city, state and ZIP in the US convention', () => {
    expect(
      formatResolvedPlace({ city: 'Elizabeth', state: 'NJ', postalCode: '07201' }),
    ).toBe('Elizabeth, NJ 07201')
  })

  it('shows only the city when state and ZIP are absent', () => {
    expect(formatResolvedPlace({ city: 'Elizabeth' })).toBe('Elizabeth')
  })

  it('shows only the ZIP when city and state are absent', () => {
    expect(formatResolvedPlace({ postalCode: '07201' })).toBe('07201')
  })

  it('joins state and ZIP without a comma when city is absent', () => {
    expect(formatResolvedPlace({ state: 'NJ', postalCode: '07201' })).toBe(
      'NJ 07201',
    )
  })

  it('returns an empty string when nothing is set', () => {
    expect(formatResolvedPlace({})).toBe('')
    expect(formatResolvedPlace(null)).toBe('')
  })

  it('ignores whitespace-only fields', () => {
    expect(formatResolvedPlace({ city: '  ', state: 'NJ' })).toBe('NJ')
  })
})
