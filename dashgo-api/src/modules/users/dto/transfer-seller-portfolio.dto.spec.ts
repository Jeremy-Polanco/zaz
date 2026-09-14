import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { TransferSellerPortfolioDto } from './transfer-seller-portfolio.dto';

const make = (value: unknown) =>
  plainToInstance(TransferSellerPortfolioDto, { toSellerId: value });

describe('TransferSellerPortfolioDto', () => {
  it('acepta el uuid del vendedor de destino', async () => {
    const dto = make('3f2504e0-4f89-11d3-9a0c-0305e82c3301');
    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it('acepta null — así el dueño DESASIGNA la cartera entera', async () => {
    const dto = make(null);
    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it('rechaza cualquier cosa que no sea un uuid', async () => {
    await expect(validate(make('seller-1'))).resolves.toHaveLength(1);
    await expect(validate(make(''))).resolves.toHaveLength(1);
  });

  it('rechaza que falte el campo — null y ausente no son lo mismo', async () => {
    // `null` es una orden explícita ("dejalos sin vendedor"); ausente es un
    // cliente mal escrito. Si pasara, una cartera entera se desasignaría sola.
    const dto = plainToInstance(TransferSellerPortfolioDto, {});
    await expect(validate(dto)).resolves.toHaveLength(1);
  });
});
