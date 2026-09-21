import { parseNominatimPlace } from './nominatim';

/**
 * Los dos payloads son RESPUESTAS REALES de Nominatim (verificadas 2026-09-21),
 * no inventadas: una a cada lado de la línea del estado, que es justamente lo
 * que decide si se cobra 6.625% o 8.875%.
 */
const ELIZABETH_NJ = {
  place_id: 1,
  lat: '40.6639',
  lon: '-74.2107',
  display_name: '1101 Elizabeth Avenue, Elizabeth, Union County, New Jersey, 07201, United States',
  address: {
    house_number: '1101',
    road: 'Elizabeth Avenue',
    city: 'Elizabeth',
    county: 'Union County',
    state: 'New Jersey',
    'ISO3166-2-lvl4': 'US-NJ',
    postcode: '07201',
    country: 'United States',
    country_code: 'us',
  },
};

const BRONX_NY = {
  place_id: 2,
  lat: '40.8448',
  lon: '-73.8648',
  display_name: '1728 Williamsbridge Road, Bronx, Bronx County, City of New York, New York, 10462, United States',
  address: {
    house_number: '1728',
    road: 'Williamsbridge Road',
    city: 'New York',
    county: 'Bronx County',
    state: 'New York',
    'ISO3166-2-lvl4': 'US-NY',
    postcode: '10462',
    country: 'United States',
    country_code: 'us',
  },
};

describe('parseNominatimPlace', () => {
  it('parsea el payload real de Elizabeth NJ', () => {
    expect(parseNominatimPlace(ELIZABETH_NJ)).toEqual({
      houseNumber: '1101',
      road: 'Elizabeth Avenue',
      city: 'Elizabeth',
      county: 'Union County',
      state: 'NJ',
      postalCode: '07201',
      countryCode: 'us',
    });
  });

  it('parsea el payload real del Bronx (city "New York", county "Bronx County")', () => {
    expect(parseNominatimPlace(BRONX_NY)).toEqual({
      houseNumber: '1728',
      road: 'Williamsbridge Road',
      city: 'New York',
      county: 'Bronx County',
      state: 'NY',
      postalCode: '10462',
      countryCode: 'us',
    });
  });

  it('saca el estado del nombre cuando falta ISO3166-2-lvl4', () => {
    const place = parseNominatimPlace({
      address: { state: 'New Jersey', postcode: '07093' },
    });
    expect(place?.state).toBe('NJ');
  });

  it('el ISO3166-2-lvl4 le GANA al nombre cuando los dos vienen', () => {
    // El nombre es texto libre de OSM y a veces queda desactualizado en el
    // borde de dos estados; el ISO es el dato estructurado. Con el mapa de
    // nombres ganando, una dirección de New York con el nombre viejo "New
    // Jersey" cobraría 6.625% en vez de 8.875%.
    const place = parseNominatimPlace({
      address: { state: 'New Jersey', 'ISO3166-2-lvl4': 'US-NY' },
    });
    expect(place?.state).toBe('NY');
  });

  it('acepta el ISO sin el prefijo US- (instancias self-hosted)', () => {
    const place = parseNominatimPlace({
      address: { state: 'New Jersey', 'ISO3166-2-lvl4': 'ny' },
    });
    expect(place?.state).toBe('NY');
  });

  it('un ISO de otro país NO se lee como sigla de estado', () => {
    // 'CA-ON' es Ontario, no California. Devolver 'ON' inventaría una
    // jurisdicción; sin estado la tasa cae en el fallback, que es la regla.
    const place = parseNominatimPlace({
      address: { state: 'Ontario', 'ISO3166-2-lvl4': 'CA-ON' },
    });
    expect(place?.state).toBeNull();
  });

  it('recorta el ZIP+4 a los primeros 5 dígitos', () => {
    const place = parseNominatimPlace({
      address: { postcode: '07201-1234', state: 'New Jersey' },
    });
    expect(place?.postalCode).toBe('07201');
  });

  it('un postcode que no tiene 5 dígitos queda en null y no rompe el resto', () => {
    const place = parseNominatimPlace({
      address: { postcode: 'SW1A', city: 'London' },
    });
    expect(place).toEqual({
      houseNumber: null,
      road: null,
      city: 'London',
      county: null,
      state: null,
      postalCode: null,
      countryCode: null,
    });
  });

  it('cae en town/village cuando no hay city', () => {
    expect(parseNominatimPlace({ address: { town: 'Kearny' } })?.city).toBe('Kearny');
    expect(parseNominatimPlace({ address: { village: 'Roseland' } })?.city).toBe('Roseland');
  });

  it('devuelve null sin objeto address, con error, o con basura', () => {
    expect(parseNominatimPlace({ error: 'Unable to geocode' })).toBeNull();
    expect(parseNominatimPlace({})).toBeNull();
    expect(parseNominatimPlace(null)).toBeNull();
    expect(parseNominatimPlace('nope')).toBeNull();
  });
});
