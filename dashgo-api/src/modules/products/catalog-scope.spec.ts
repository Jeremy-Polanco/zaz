import { applyCatalogScope, resolveVisibleProductIds } from './catalog-scope';

const P = (id: string) => ({ id });
const ALL = [P('a'), P('b'), P('c')];

describe('resolveVisibleProductIds', () => {
  it('no filtra cuando no hay catálogo de vendedor (cliente sin vendedor)', () => {
    expect(resolveVisibleProductIds(null)).toBeNull();
    expect(resolveVisibleProductIds(undefined)).toBeNull();
  });

  it('no filtra cuando el vendedor no cargó NINGÚN producto', () => {
    // Salvaguarda: un vendedor nuevo no puede dejar a su cartera sin comprar.
    expect(resolveVisibleProductIds([])).toBeNull();
  });

  it('filtra al set del vendedor cuando tiene catálogo', () => {
    expect(resolveVisibleProductIds(['a', 'c'])).toEqual(new Set(['a', 'c']));
  });
});

describe('applyCatalogScope', () => {
  it('devuelve todo para un cliente sin vendedor', () => {
    expect(applyCatalogScope(ALL, null)).toEqual(ALL);
  });

  it('devuelve todo cuando el vendedor tiene catálogo vacío', () => {
    expect(applyCatalogScope(ALL, [])).toEqual(ALL);
  });

  it('deja solo los productos del vendedor', () => {
    expect(applyCatalogScope(ALL, ['a', 'c'])).toEqual([P('a'), P('c')]);
  });

  it('ignora ids del catálogo que ya no existen o no están disponibles', () => {
    // El catálogo del vendedor puede referenciar un producto dado de baja; el
    // filtro parte de la lista real, así que simplemente no aparece.
    expect(applyCatalogScope(ALL, ['a', 'borrado'])).toEqual([P('a')]);
  });

  it('un catálogo que no intersecta deja la lista vacía — no cae a "todo"', () => {
    // Este es el único caso en que el cliente ve cero productos, y es porque
    // el admin lo pidió explícitamente: cargó catálogo, y nada de eso está
    // disponible hoy. Distinto de "no cargó nada".
    expect(applyCatalogScope(ALL, ['x', 'y'])).toEqual([]);
  });
});
