import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { GeocodingService } from './geocoding.service';

const ELIZABETH_NJ = {
  address: {
    house_number: '1101',
    road: 'Elizabeth Avenue',
    city: 'Elizabeth',
    county: 'Union County',
    state: 'New Jersey',
    'ISO3166-2-lvl4': 'US-NJ',
    postcode: '07201',
    country_code: 'us',
  },
};

const BRONX_NY = {
  address: {
    house_number: '1728',
    road: 'Williamsbridge Road',
    city: 'New York',
    county: 'Bronx County',
    state: 'New York',
    'ISO3166-2-lvl4': 'US-NY',
    postcode: '10462',
    country_code: 'us',
  },
};

function okResponse(payload: unknown) {
  return { ok: true, status: 200, json: () => Promise.resolve(payload) };
}

function makeConfig(env: Record<string, string> = {}): ConfigService {
  return {
    get: <T>(key: string, fallback?: T) => (env[key] as unknown as T) ?? fallback,
  } as unknown as ConfigService;
}

async function build(env: Record<string, string> = {}): Promise<GeocodingService> {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      GeocodingService,
      { provide: ConfigService, useValue: makeConfig(env) },
    ],
  }).compile();
  return module.get(GeocodingService);
}

describe('GeocodingService.reverse', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    (global as unknown as { fetch: unknown }).fetch = fetchMock;
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('devuelve el lugar parseado de Elizabeth NJ', async () => {
    fetchMock.mockResolvedValue(okResponse(ELIZABETH_NJ));
    const service = await build();

    await expect(service.reverse(40.6639, -74.2107)).resolves.toEqual({
      houseNumber: '1101',
      road: 'Elizabeth Avenue',
      city: 'Elizabeth',
      county: 'Union County',
      state: 'NJ',
      postalCode: '07201',
      countryCode: 'us',
    });
  });

  it('devuelve el lugar parseado del Bronx', async () => {
    fetchMock.mockResolvedValue(okResponse(BRONX_NY));
    const service = await build();

    const place = await service.reverse(40.8448, -73.8648);
    expect(place).toMatchObject({ state: 'NY', county: 'Bronx County', postalCode: '10462', houseNumber: '1728' });
  });

  it('pega a la URL de Nominatim con el User-Agent obligatorio por la política de uso', async () => {
    fetchMock.mockResolvedValue(okResponse(ELIZABETH_NJ));
    const service = await build();

    await service.reverse(40.6639, -74.2107);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('https://nominatim.openstreetmap.org/reverse');
    expect(url).toContain('lat=40.6639');
    expect(url).toContain('lon=-74.2107');
    expect(url).toContain('format=jsonv2');
    expect(url).toContain('addressdetails=1');
    expect((init.headers as Record<string, string>)['User-Agent']).toBe(
      'Udash/1.0 (+https://www.dashgo.dev)',
    );
    expect(init.signal).toBeDefined();
  });

  it('respeta NOMINATIM_BASE_URL', async () => {
    fetchMock.mockResolvedValue(okResponse(ELIZABETH_NJ));
    const service = await build({ NOMINATIM_BASE_URL: 'http://nominatim.internal:8080/' });

    await service.reverse(40.6639, -74.2107);

    expect((fetchMock.mock.calls[0] as [string])[0]).toContain(
      'http://nominatim.internal:8080/reverse',
    );
  });

  it('un timeout devuelve null y NO tumba a quien llama', async () => {
    fetchMock.mockRejectedValue(
      Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }),
    );
    const service = await build();

    await expect(service.reverse(40.6639, -74.2107)).resolves.toBeNull();
  });

  it('una respuesta no-200 devuelve null', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 429, json: () => Promise.resolve({}) });
    const service = await build();

    await expect(service.reverse(40.6639, -74.2107)).resolves.toBeNull();
  });

  it('un JSON ilegible devuelve null', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.reject(new Error('Unexpected token <')),
    });
    const service = await build();

    await expect(service.reverse(40.6639, -74.2107)).resolves.toBeNull();
  });

  it('GEOCODING_ENABLED=false devuelve null SIN pegarle a la red', async () => {
    const service = await build({ GEOCODING_ENABLED: 'false' });

    await expect(service.reverse(40.6639, -74.2107)).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('lat/lng inválidas devuelven null sin red', async () => {
    const service = await build();

    await expect(service.reverse(NaN, -74.2107)).resolves.toBeNull();
    await expect(
      service.reverse(undefined as unknown as number, null as unknown as number),
    ).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('cachea: dos llamadas a la misma coordenada = un solo fetch (lo exige la política de Nominatim)', async () => {
    fetchMock.mockResolvedValue(okResponse(ELIZABETH_NJ));
    const service = await build();

    const first = await service.reverse(40.6639, -74.2107);
    const second = await service.reverse(40.66390004, -74.21070001);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
  });

  it('un error NO se cachea: el siguiente intento vuelve a preguntar', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 503, json: () => Promise.resolve({}) })
      .mockResolvedValueOnce(okResponse(ELIZABETH_NJ));
    const service = await build();

    await expect(service.reverse(40.6639, -74.2107)).resolves.toBeNull();
    await expect(service.reverse(40.6639, -74.2107)).resolves.toMatchObject({ state: 'NJ' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('el caché tiene tope: no crece sin límite en un backfill largo', async () => {
    fetchMock.mockResolvedValue(okResponse(ELIZABETH_NJ));
    const service = await build();

    for (let i = 0; i < 520; i++) {
      await service.reverse(40 + i / 100000, -74);
    }

    expect(service.cacheSize).toBeLessThanOrEqual(500);
  });
});
