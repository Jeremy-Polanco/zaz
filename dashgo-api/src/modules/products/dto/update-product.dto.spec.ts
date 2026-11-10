import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateProductDto } from './update-product.dto';

const errorsFor = async (associatePriceCents: unknown) => {
  const errors = await validate(
    plainToInstance(UpdateProductDto, { associatePriceCents }),
  );
  return errors.filter((e) => e.property === 'associatePriceCents');
};

describe('UpdateProductDto — associatePriceCents', () => {
  it('rechaza 0 (el precio de asociado debe ser mayor a 0)', async () => {
    expect(await errorsFor(0)).toHaveLength(1);
  });

  it('acepta un precio válido', async () => {
    expect(await errorsFor(450)).toHaveLength(0);
  });

  it('acepta null (limpia el precio)', async () => {
    expect(await errorsFor(null)).toHaveLength(0);
  });

  it('rechaza decimales y valores sobre el máximo', async () => {
    expect(await errorsFor(4.5)).toHaveLength(1);
    expect(await errorsFor(1000001)).toHaveLength(1);
  });
});
