import { taxRateTransformer } from './delivery-zone.entity';

/**
 * Postgres devuelve `numeric` como STRING. La tasa se multiplica por centavos
 * en cuanto sale de la base, y '0.06625' * 1000 en JavaScript es coerción
 * silenciosa: funciona hasta que alguien la compara o la suma. El transformer
 * la convierte una sola vez, acá.
 */
describe('DeliveryZone — taxRateTransformer', () => {
  it('convierte el numeric de Postgres a number', () => {
    expect(taxRateTransformer.from('0.06625')).toBe(0.06625);
    expect(taxRateTransformer.from('0.08875')).toBe(0.08875);
  });

  it('el 0% es un valor válido, no un faltante', () => {
    expect(taxRateTransformer.from('0.00000')).toBe(0);
  });

  it('escribe el número tal cual', () => {
    expect(taxRateTransformer.to(0.06625)).toBe(0.06625);
  });
});

/**
 * Desde la migración 1809 la tasa de la zona es un OVERRIDE opcional: NULL
 * significa "no piso nada, cobrá lo que diga la ley" (ver tax_jurisdictions).
 * El transformer tiene que devolver ese NULL tal cual — convertirlo a NaN, que
 * es lo que hacía parseFloat(''), lo volvía indistinguible de un dato corrupto
 * y hacía que la zona se comiera la jurisdicción.
 */
describe('DeliveryZone — taxRateTransformer con NULL', () => {
  it('NULL sigue siendo NULL, no NaN', () => {
    expect(taxRateTransformer.from(null)).toBeNull();
  });

  it('el 0% no se confunde con NULL', () => {
    expect(taxRateTransformer.from('0.00000')).toBe(0);
    expect(taxRateTransformer.from(null)).not.toBe(0);
  });
});
