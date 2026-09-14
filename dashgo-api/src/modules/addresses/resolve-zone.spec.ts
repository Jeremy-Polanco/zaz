import { resolveZoneId } from './resolve-zone';

// Las cuatro zonas que siembra la migración 1807000000000, con los ZIP reales
// de NYC/NJ. Se replican acá a propósito: si alguien cambia los prefijos
// sembrados, estos casos son los que tienen que discutirse.
const SEEDED = [
  { id: 'bronx', zipPrefixes: ['104'], isActive: true },
  { id: 'brooklyn', zipPrefixes: ['112'], isActive: true },
  { id: 'manhattan', zipPrefixes: ['100', '101', '102'], isActive: true },
  { id: 'elizabeth', zipPrefixes: ['0720'], isActive: true },
];

describe('resolveZoneId', () => {
  it('resuelve el ZIP del cliente contra los prefijos sembrados', () => {
    expect(resolveZoneId('10451', SEEDED)).toBe('bronx');
    expect(resolveZoneId('11201', SEEDED)).toBe('brooklyn');
    expect(resolveZoneId('10012', SEEDED)).toBe('manhattan');
    expect(resolveZoneId('07201', SEEDED)).toBe('elizabeth');
  });

  it('gana el prefijo MÁS LARGO — una zona fina le gana a una gruesa', () => {
    // Sin esta regla habría que inventar prioridades explícitas: el dueño
    // quiere poder meter "1045" (un barrio del Bronx) sin tocar "104".
    const zones = [
      ...SEEDED,
      { id: 'bronx-sur', zipPrefixes: ['1045'], isActive: true },
    ];
    expect(resolveZoneId('10451', zones)).toBe('bronx-sur');
    // Un ZIP del Bronx que NO cae en el barrio fino sigue siendo Bronx.
    expect(resolveZoneId('10467', zones)).toBe('bronx');
  });

  it('ignora las zonas apagadas', () => {
    // Apagar una zona no la borra (las órdenes viejas la referencian), pero
    // deja de clasificar direcciones nuevas.
    const zones = [
      { id: 'bronx', zipPrefixes: ['104'], isActive: false },
      { id: 'bronx-sur', zipPrefixes: ['1045'], isActive: false },
    ];
    expect(resolveZoneId('10451', zones)).toBeNull();
  });

  it('el prefijo más largo APAGADO no tapa al más corto activo', () => {
    const zones = [
      { id: 'bronx', zipPrefixes: ['104'], isActive: true },
      { id: 'bronx-sur', zipPrefixes: ['1045'], isActive: false },
    ];
    expect(resolveZoneId('10451', zones)).toBe('bronx');
  });

  it('devuelve null cuando ningún prefijo matchea', () => {
    expect(resolveZoneId('90210', SEEDED)).toBeNull();
  });

  it('devuelve null cuando la dirección no tiene ZIP', () => {
    // Las direcciones viejas nacen sin código postal y las de la chincheta del
    // admin pueden no traerlo: sin ZIP no hay zona, no es un error.
    expect(resolveZoneId(null, SEEDED)).toBeNull();
    expect(resolveZoneId('', SEEDED)).toBeNull();
  });

  it('devuelve null cuando no hay zonas cargadas', () => {
    expect(resolveZoneId('10451', [])).toBeNull();
  });

  it('ignora prefijos vacíos — matchearían cualquier ZIP', () => {
    // `''` es prefijo de TODO: una zona mal cargada se llevaría a todos los
    // clientes puestos por delante.
    const zones = [{ id: 'catch-all', zipPrefixes: [''], isActive: true }];
    expect(resolveZoneId('10451', zones)).toBeNull();
  });
});
