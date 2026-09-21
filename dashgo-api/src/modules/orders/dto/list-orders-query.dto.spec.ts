import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ListOrdersQueryDto } from './list-orders-query.dto';

// Los query params llegan como strings (Express nunca los tipa), por eso se
// arma el plain object con strings — igual que Nest cuando parsea la URL —
// y no con números ya convertidos.
const make = (lat?: string, lng?: string) =>
  plainToInstance(ListOrdersQueryDto, {
    ...(lat === undefined ? {} : { lat }),
    ...(lng === undefined ? {} : { lng }),
  });

describe('ListOrdersQueryDto — GET /orders?lat&lng', () => {
  it('es opcional — sin coordenadas no hay errores', async () => {
    const dto = make();
    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it('acepta coordenadas válidas y las transforma a number', async () => {
    const dto = make('18.4861', '-69.9312');
    await expect(validate(dto)).resolves.toHaveLength(0);
    expect(dto.lat).toBe(18.4861);
    expect(dto.lng).toBe(-69.9312);
  });

  it('rechaza lat fuera de rango (91)', async () => {
    const errors = await validate(make('91', '-69.9312'));
    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('lat');
  });

  it('rechaza lng fuera de rango (-181)', async () => {
    const errors = await validate(make('18.4861', '-181'));
    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('lng');
  });

  it('rechaza texto libre que no es un número', async () => {
    const errors = await validate(make('abc', '-69.9312'));
    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('lat');
  });
});
