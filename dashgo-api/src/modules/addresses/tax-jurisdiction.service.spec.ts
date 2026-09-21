import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DeliveryZone } from '../../entities/delivery-zone.entity';
import { TaxJurisdiction } from '../../entities/tax-jurisdiction.entity';
import { TAX_RATE } from '../../common/tax';
import { TaxJurisdictionService } from './tax-jurisdiction.service';

const NJ_RATE = 0.06625;
const NYC_RATE = 0.08875;

function zone(overrides: Partial<DeliveryZone>): DeliveryZone {
  return {
    id: 'zone-x',
    name: 'Zona',
    zipPrefixes: [],
    surchargeCents: 0,
    // La tasa de zona nace en NULL: la ley la pone la jurisdicción, la zona
    // sólo la pisa cuando alguien lo decide a mano.
    taxRate: null,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as DeliveryZone;
}

function jurisdiction(overrides: Partial<TaxJurisdiction>): TaxJurisdiction {
  return {
    id: 'jur-x',
    code: 'NJ',
    name: 'New Jersey',
    taxRate: NJ_RATE,
    source: 'N.J.S.A. 54:32B-3',
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as TaxJurisdiction;
}

const elizabeth = zone({ id: 'zone-nj', name: 'Elizabeth NJ', zipPrefixes: ['0720'] });
const bronx = zone({ id: 'zone-bronx', name: 'Bronx', zipPrefixes: ['104'] });

const NJ = jurisdiction({ id: 'jur-nj', code: 'NJ', taxRate: NJ_RATE });
const NYC = jurisdiction({
  id: 'jur-nyc',
  code: 'NYC',
  name: 'New York City',
  taxRate: NYC_RATE,
});

describe('TaxJurisdictionService.resolveTaxRate', () => {
  let service: TaxJurisdictionService;
  let zonesRepo: jest.Mocked<Repository<DeliveryZone>>;
  let jurisdictionsRepo: jest.Mocked<Repository<TaxJurisdiction>>;

  const setZones = (zones: DeliveryZone[]) =>
    (zonesRepo.find as jest.Mock).mockResolvedValue(zones);
  const setJurisdictions = (rows: TaxJurisdiction[]) =>
    (jurisdictionsRepo.find as jest.Mock).mockResolvedValue(rows);

  beforeEach(async () => {
    zonesRepo = { find: jest.fn().mockResolvedValue([]) } as unknown as jest.Mocked<
      Repository<DeliveryZone>
    >;
    jurisdictionsRepo = {
      find: jest.fn().mockResolvedValue([NJ, NYC]),
    } as unknown as jest.Mocked<Repository<TaxJurisdiction>>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TaxJurisdictionService,
        { provide: getRepositoryToken(DeliveryZone), useValue: zonesRepo },
        { provide: getRepositoryToken(TaxJurisdiction), useValue: jurisdictionsRepo },
      ],
    }).compile();

    service = module.get(TaxJurisdictionService);
  });

  // ── (1) La zona con override gana ────────────────────────────────────────
  describe('override de zona', () => {
    it('una zona con tax_rate cargado a mano le gana a la ley', async () => {
      setZones([zone({ id: 'zone-especial', zipPrefixes: ['0720'], taxRate: 0.05 })]);

      await expect(
        service.resolveTaxRate({ postalCode: '07201', state: 'NJ' }),
      ).resolves.toEqual({
        zoneId: 'zone-especial',
        jurisdiction: 'NJ',
        taxRate: 0.05,
      });
    });

    it('una zona con tax_rate NULL NO fija nada: manda la jurisdicción', async () => {
      setZones([elizabeth]);

      await expect(
        service.resolveTaxRate({ postalCode: '07201', state: 'NJ' }),
      ).resolves.toEqual({
        zoneId: 'zone-nj',
        jurisdiction: 'NJ',
        taxRate: NJ_RATE,
      });
    });

    it('el override también se toma por zone_id cuando no hay ZIP', async () => {
      setZones([zone({ id: 'zone-especial', zipPrefixes: ['999'], taxRate: 0.05 })]);

      await expect(
        service.resolveTaxRate({ zoneId: 'zone-especial' }),
      ).resolves.toMatchObject({ zoneId: 'zone-especial', taxRate: 0.05 });
    });

    it('una zona APAGADA no aparece: no fija tasa ni zona', async () => {
      setZones([]); // el repo sólo trae activas

      await expect(
        service.resolveTaxRate({ zoneId: 'zone-apagada', postalCode: '07201' }),
      ).resolves.toEqual({ zoneId: null, jurisdiction: 'NJ', taxRate: NJ_RATE });
    });

    it('un override corrupto (fuera de [0,1)) cae al fallback histórico, nunca a 0', async () => {
      setZones([zone({ id: 'zone-rota', zipPrefixes: ['0720'], taxRate: 1.5 })]);

      await expect(
        service.resolveTaxRate({ postalCode: '07201' }),
      ).resolves.toMatchObject({ taxRate: TAX_RATE });
    });

    it('un override de 0% SÍ se respeta: es un dato, no un faltante', async () => {
      setZones([zone({ id: 'zone-cero', zipPrefixes: ['0720'], taxRate: 0 })]);

      await expect(
        service.resolveTaxRate({ postalCode: '07201' }),
      ).resolves.toMatchObject({ taxRate: 0 });
    });
  });

  // ── (2) La jurisdicción = la ley ─────────────────────────────────────────
  describe('jurisdicción', () => {
    it('New Jersey por estado → 6.625%', async () => {
      await expect(
        service.resolveTaxRate({ state: 'NJ', city: 'Elizabeth', postalCode: '07201' }),
      ).resolves.toEqual({ zoneId: null, jurisdiction: 'NJ', taxRate: NJ_RATE });
    });

    it('NYC por ciudad ("New York") → 8.875%', async () => {
      await expect(
        service.resolveTaxRate({ state: 'NY', city: 'New York', postalCode: '10462' }),
      ).resolves.toEqual({ zoneId: null, jurisdiction: 'NYC', taxRate: NYC_RATE });
    });

    it.each([
      ['Bronx County'],
      ['Kings County'],
      ['Queens County'],
      ['New York County'],
      ['Richmond County'],
    ])('NYC por condado: %s → 8.875%%', async (county) => {
      await expect(
        service.resolveTaxRate({ state: 'NY', county }),
      ).resolves.toMatchObject({ jurisdiction: 'NYC', taxRate: NYC_RATE });
    });

    it.each(['100', '101', '102', '103', '104', '110', '111', '112', '113', '114', '116'])(
      'NYC por prefijo de ZIP: %s → 8.875%%',
      async (prefix) => {
        await expect(
          service.resolveTaxRate({ state: 'NY', postalCode: `${prefix}62` }),
        ).resolves.toMatchObject({ jurisdiction: 'NYC', taxRate: NYC_RATE });
      },
    );

    it('estado NY pero FUERA de la ciudad (Albany) → sin jurisdicción, fallback histórico', async () => {
      await expect(
        service.resolveTaxRate({
          state: 'NY',
          city: 'Albany',
          county: 'Albany County',
          postalCode: '12207',
        }),
      ).resolves.toEqual({ zoneId: null, jurisdiction: null, taxRate: TAX_RATE });
    });

    it('ZIP de NJ sin estado (fila vieja sin backfill) igual resuelve NJ', async () => {
      await expect(
        service.resolveTaxRate({ postalCode: '07201' }),
      ).resolves.toMatchObject({ jurisdiction: 'NJ', taxRate: NJ_RATE });
      await expect(
        service.resolveTaxRate({ postalCode: '08901' }),
      ).resolves.toMatchObject({ jurisdiction: 'NJ', taxRate: NJ_RATE });
    });

    it('ZIP de NYC sin estado igual resuelve NYC', async () => {
      await expect(
        service.resolveTaxRate({ postalCode: '10462' }),
      ).resolves.toMatchObject({ jurisdiction: 'NYC', taxRate: NYC_RATE });
    });

    it('el ESTADO le gana al ZIP: NJ con un ZIP de NYC sigue siendo NJ', async () => {
      await expect(
        service.resolveTaxRate({ state: 'NJ', postalCode: '10462' }),
      ).resolves.toMatchObject({ jurisdiction: 'NJ', taxRate: NJ_RATE });
    });

    it('una jurisdicción APAGADA no cobra: cae al fallback', async () => {
      setJurisdictions([jurisdiction({ code: 'NYC', taxRate: NYC_RATE })]);

      await expect(
        service.resolveTaxRate({ state: 'NJ', postalCode: '07201' }),
      ).resolves.toEqual({ zoneId: null, jurisdiction: 'NJ', taxRate: TAX_RATE });
    });

    it('una tasa de jurisdicción corrupta cae al fallback, nunca a 0', async () => {
      setJurisdictions([jurisdiction({ code: 'NJ', taxRate: NaN })]);

      await expect(
        service.resolveTaxRate({ state: 'NJ' }),
      ).resolves.toMatchObject({ jurisdiction: 'NJ', taxRate: TAX_RATE });
    });
  });

  // ── (3) Fallback ─────────────────────────────────────────────────────────
  describe('fallback', () => {
    it('sin ningún dato no se le pega a ninguna tabla', async () => {
      await expect(service.resolveTaxRate({})).resolves.toEqual({
        zoneId: null,
        jurisdiction: null,
        taxRate: TAX_RATE,
      });
      expect(zonesRepo.find).not.toHaveBeenCalled();
      expect(jurisdictionsRepo.find).not.toHaveBeenCalled();
    });

    it('un ZIP de California (90210) no es de nadie: fallback histórico', async () => {
      setZones([elizabeth, bronx]);

      await expect(service.resolveTaxRate({ postalCode: '90210' })).resolves.toEqual({
        zoneId: null,
        jurisdiction: null,
        taxRate: TAX_RATE,
      });
    });
  });

  // ── Lote ─────────────────────────────────────────────────────────────────
  describe('resolveTaxRates (lote)', () => {
    it('resuelve una lista con UNA lectura de cada tabla', async () => {
      setZones([elizabeth, bronx]);

      const rates = await service.resolveTaxRates([
        { postalCode: '07201', state: 'NJ' },
        { postalCode: '10462', state: 'NY', county: 'Bronx County' },
        { postalCode: '90210' },
      ]);

      expect(rates).toEqual([
        { zoneId: 'zone-nj', jurisdiction: 'NJ', taxRate: NJ_RATE },
        { zoneId: 'zone-bronx', jurisdiction: 'NYC', taxRate: NYC_RATE },
        { zoneId: null, jurisdiction: null, taxRate: TAX_RATE },
      ]);
      expect(zonesRepo.find).toHaveBeenCalledTimes(1);
      expect(jurisdictionsRepo.find).toHaveBeenCalledTimes(1);
    });

    it('una lista vacía no consulta nada', async () => {
      await expect(service.resolveTaxRates([])).resolves.toEqual([]);
      expect(zonesRepo.find).not.toHaveBeenCalled();
    });
  });
});
