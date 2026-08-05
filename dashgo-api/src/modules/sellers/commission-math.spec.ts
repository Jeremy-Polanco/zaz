import { computeSellerCommissionCents } from './commission-math';

const line = (productId: string, priceCents: number, quantity = 1) => ({
  productId,
  priceCents,
  quantity,
});

describe('computeSellerCommissionCents', () => {
  it('un carrito vacío no genera comisión', () => {
    expect(computeSellerCommissionCents([], new Map())).toBe(0);
  });

  it('aplica el porcentaje del producto', () => {
    // $10.00 al 8% = $0.80
    expect(
      computeSellerCommissionCents([line('p1', 1000)], new Map([['p1', 8]])),
    ).toBe(80);
  });

  it('multiplica por la cantidad', () => {
    expect(
      computeSellerCommissionCents([line('p1', 1000, 3)], new Map([['p1', 8]])),
    ).toBe(240);
  });

  it('suma varias líneas con porcentajes distintos', () => {
    const pct = new Map([
      ['p1', 10],
      ['p2', 5],
    ]);
    expect(
      computeSellerCommissionCents([line('p1', 1000), line('p2', 2000)], pct),
    ).toBe(100 + 100);
  });

  it('un producto FUERA del catálogo del vendedor no paga comisión', () => {
    expect(
      computeSellerCommissionCents(
        [line('p1', 1000), line('ajeno', 5000)],
        new Map([['p1', 8]]),
      ),
    ).toBe(80);
  });

  it('un producto cargado con 0% no paga comisión', () => {
    expect(
      computeSellerCommissionCents([line('p1', 1000)], new Map([['p1', 0]])),
    ).toBe(0);
  });

  it('calcula sobre lo REALMENTE cobrado, no sobre el precio de catálogo', () => {
    // El cliente pagó $3.50 (precio de suscriptor) por algo de catálogo $10.
    // La comisión sale de los $3.50: comisionar un precio que nadie pagó es
    // cómo se paga más comisión que margen.
    expect(
      computeSellerCommissionCents([line('p1', 350)], new Map([['p1', 10]])),
    ).toBe(35);
  });

  it('una línea gratis ($0) no genera comisión', () => {
    expect(
      computeSellerCommissionCents([line('p1', 0, 2)], new Map([['p1', 10]])),
    ).toBe(0);
  });

  it('redondea al centavo por línea, no al final', () => {
    // 333 * 7.5% = 24.975 → 25 por línea.
    expect(
      computeSellerCommissionCents([line('p1', 333)], new Map([['p1', 7.5]])),
    ).toBe(25);
  });
});
