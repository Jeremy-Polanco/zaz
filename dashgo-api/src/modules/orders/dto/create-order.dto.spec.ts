import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateOrderDto, DeliveryAddressDto } from './create-order.dto';
import { PaymentMethod } from '../../../entities/enums';

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

// El id de la dirección GUARDADA del cliente. Va al tope del DTO y NO adentro
// del snapshot a propósito: el snapshot se persiste tal cual en el JSONB de la
// orden, y ahí un id de otra tabla sería basura que nadie sabe mantener.
const makeOrder = (deliveryAddressId?: unknown) =>
  plainToInstance(CreateOrderDto, {
    items: [{ productId: '11111111-1111-4111-8111-111111111111', quantity: 1 }],
    paymentMethod: PaymentMethod.CASH,
    ...(deliveryAddressId === undefined ? {} : { deliveryAddressId }),
  });

describe('CreateOrderDto — deliveryAddressId', () => {
  it('acepta un UUID', async () => {
    const errors = await validate(
      makeOrder('22222222-2222-4222-8222-222222222222'),
    );
    expect(errors).toHaveLength(0);
  });

  it('es opcional — los clientes viejos (mobile <= 1.0.8) no lo mandan', async () => {
    await expect(validate(makeOrder())).resolves.toHaveLength(0);
  });

  it('rechaza lo que no sea un UUID: un id inventado no puede elegir la tasa', async () => {
    const errors = await validate(makeOrder('no-soy-un-uuid'));
    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('deliveryAddressId');
  });
});
