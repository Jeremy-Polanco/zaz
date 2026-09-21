import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DeliveryZone } from '../../entities/delivery-zone.entity';
import { TAX_RATE } from '../../common/tax';
import { DeliveryZonesService } from './delivery-zones.service';

const NJ_RATE = 0.06625;
const NYC_RATE = 0.08875;

function zone(overrides: Partial<DeliveryZone>): DeliveryZone {
  return {
    id: 'zone-x',
    name: 'Zona',
    zipPrefixes: [],
    surchargeCents: 0,
    taxRate: TAX_RATE,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as DeliveryZone;
}

const elizabeth = zone({
  id: 'zone-nj',
  name: 'Elizabeth NJ',
  zipPrefixes: ['0720'],
  taxRate: NJ_RATE,
});
const bronx = zone({
  id: 'zone-bronx',
  name: 'Bronx',
  zipPrefixes: ['104'],
  taxRate: NYC_RATE,
});

describe('DeliveryZonesService.resolveTaxRate', () => {
  let service: DeliveryZonesService;
  let zonesRepo: jest.Mocked<Repository<DeliveryZone>>;

  // El repo sólo devuelve las zonas ACTIVAS: la pregunta "¿esta zona está
  // encendida?" se contesta con la misma consulta que resuelve el prefijo.
  const setZones = (zones: DeliveryZone[]) =>
    (zonesRepo.find as jest.Mock).mockResolvedValue(zones);

  beforeEach(async () => {
    zonesRepo = {
      find: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<Repository<DeliveryZone>>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DeliveryZonesService,
        { provide: getRepositoryToken(DeliveryZone), useValue: zonesRepo },
      ],
    }).compile();

    service = module.get(DeliveryZonesService);
  });

  it('una zona activa por id devuelve SU tasa', async () => {
    setZones([elizabeth, bronx]);
    await expect(service.resolveTaxRate({ zoneId: 'zone-nj' })).resolves.toEqual(
      { zoneId: 'zone-nj', taxRate: NJ_RATE },
    );
  });

  it('el ZIP le gana al id guardado: `zone_id` es un cache que nadie refresca', async () => {
    // `user_addresses.zone_id` se resolvió el día que se guardó la dirección y
    // NO se vuelve a tocar si el admin le cambia los prefijos a una zona. El
    // código postal sí es el dato del cliente: manda él.
    setZones([elizabeth, bronx]);
    await expect(
      service.resolveTaxRate({ zoneId: 'zone-nj', postalCode: '10451' }),
    ).resolves.toEqual({ zoneId: 'zone-bronx', taxRate: NYC_RATE });
  });

  it('el id guardado resuelve cuando el ZIP no matchea ninguna zona', async () => {
    // El cache sigue sirviendo de respaldo: una dirección con zona asignada a
    // mano (ZIP fuera de todo prefijo) conserva la tasa que le pusieron.
    setZones([elizabeth, bronx]);
    await expect(
      service.resolveTaxRate({ zoneId: 'zone-nj', postalCode: '90210' }),
    ).resolves.toEqual({ zoneId: 'zone-nj', taxRate: NJ_RATE });
  });

  it('una zona apagada NO resuelve: cae al código postal', async () => {
    // La zona vieja sigue existiendo (las órdenes la referencian) pero ya no
    // clasifica. El ZIP es el que manda.
    setZones([bronx]);
    await expect(
      service.resolveTaxRate({ zoneId: 'zone-apagada', postalCode: '10451' }),
    ).resolves.toEqual({ zoneId: 'zone-bronx', taxRate: NYC_RATE });
  });

  it('una zona apagada y sin ZIP cae en el fallback histórico', async () => {
    setZones([bronx]);
    await expect(
      service.resolveTaxRate({ zoneId: 'zone-apagada' }),
    ).resolves.toEqual({ zoneId: null, taxRate: TAX_RATE });
  });

  it('resuelve por prefijo de ZIP cuando no hay zona guardada', async () => {
    setZones([elizabeth, bronx]);
    await expect(
      service.resolveTaxRate({ postalCode: '07201' }),
    ).resolves.toEqual({ zoneId: 'zone-nj', taxRate: NJ_RATE });
  });

  it('un ZIP que no matchea ninguna zona cobra el fallback, NUNCA 0', async () => {
    setZones([elizabeth, bronx]);
    await expect(
      service.resolveTaxRate({ postalCode: '90210' }),
    ).resolves.toEqual({ zoneId: null, taxRate: TAX_RATE });
  });

  it('sin zona ni ZIP no consulta la base: no hay nada que resolver', async () => {
    await expect(service.resolveTaxRate({})).resolves.toEqual({
      zoneId: null,
      taxRate: TAX_RATE,
    });
    expect(zonesRepo.find).not.toHaveBeenCalled();
  });

  it('una tasa corrupta en la base cae al fallback — nunca cobrar de menos', async () => {
    setZones([zone({ id: 'zone-rota', zipPrefixes: ['104'], taxRate: NaN })]);
    await expect(
      service.resolveTaxRate({ postalCode: '10451' }),
    ).resolves.toEqual({ zoneId: 'zone-rota', taxRate: TAX_RATE });
  });

  it('una zona configurada en 0% se respeta: es un dato, no un faltante', async () => {
    setZones([zone({ id: 'zone-free', zipPrefixes: ['104'], taxRate: 0 })]);
    await expect(
      service.resolveTaxRate({ postalCode: '10451' }),
    ).resolves.toEqual({ zoneId: 'zone-free', taxRate: 0 });
  });

  it('el ZIP le gana al id tambien en el lote', async () => {
    setZones([elizabeth, bronx]);
    await expect(
      service.resolveTaxRates([{ zoneId: 'zone-nj', postalCode: '10451' }]),
    ).resolves.toEqual([{ zoneId: 'zone-bronx', taxRate: NYC_RATE }]);
  });

  it('resuelve un lote con UNA sola consulta', async () => {
    setZones([elizabeth, bronx]);
    await expect(
      service.resolveTaxRates([
        { zoneId: 'zone-nj' },
        { postalCode: '10451' },
        { postalCode: '90210' },
      ]),
    ).resolves.toEqual([
      { zoneId: 'zone-nj', taxRate: NJ_RATE },
      { zoneId: 'zone-bronx', taxRate: NYC_RATE },
      { zoneId: null, taxRate: TAX_RATE },
    ]);
    expect(zonesRepo.find).toHaveBeenCalledTimes(1);
  });

  it('un lote vacío no consulta nada', async () => {
    await expect(service.resolveTaxRates([])).resolves.toEqual([]);
    expect(zonesRepo.find).not.toHaveBeenCalled();
  });
});
