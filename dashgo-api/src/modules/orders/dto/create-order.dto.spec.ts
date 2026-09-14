import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { DeliveryAddressDto } from './create-order.dto';

// La chincheta del admin (PATCH /orders/:id/delivery-address) usa este mismo
// DTO: el código postal se valida igual que en la libreta del cliente, porque
// después alimenta la misma resolución de zona por prefijo.
const make = (postalCode?: unknown) =>
  plainToInstance(DeliveryAddressDto, {
    text: 'Calle 1',
    lat: 40.82,
    lng: -73.92,
    ...(postalCode === undefined ? {} : { postalCode }),
  });

describe('DeliveryAddressDto — postalCode', () => {
  it('acepta un ZIP de 5 dígitos', async () => {
    await expect(validate(make('10451'))).resolves.toHaveLength(0);
  });

  it('es opcional — la chincheta vieja no manda código postal', async () => {
    await expect(validate(make())).resolves.toHaveLength(0);
  });

  it('recorta espacios', async () => {
    const dto = make(' 07201 ');
    expect(dto.postalCode).toBe('07201');
    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it('rechaza lo que no sean 5 dígitos, con el mismo mensaje que el cliente', async () => {
    const errors = await validate(make('104'));
    expect(errors).toHaveLength(1);
    expect(errors[0].constraints?.matches).toBe(
      'El código postal debe tener 5 dígitos',
    );
  });
});
