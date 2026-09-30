import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SetQuoteDto } from './set-quote.dto';

const make = (scheduledDeliveryDate?: unknown) =>
  plainToInstance(SetQuoteDto, { shippingCents: 500, scheduledDeliveryDate });

describe('SetQuoteDto.scheduledDeliveryDate', () => {
  it('acepta un día real, null (desasignar) y ausente (dejarlo como está)', async () => {
    await expect(validate(make('2026-09-16'))).resolves.toHaveLength(0);
    await expect(validate(make(null))).resolves.toHaveLength(0);
    await expect(validate(make(undefined))).resolves.toHaveLength(0);
  });

  it('rechaza una fecha con hora', async () => {
    await expect(
      validate(make('2026-09-16T00:00:00.000Z')),
    ).resolves.toHaveLength(1);
  });

  it('rechaza un día con forma válida que NO existe en el calendario', async () => {
    // Mismo hueco que SetDeliveryDateDto: el regex deja pasar '2026-02-30' y
    // Postgres lo rechaza al escribir → 500 en vez de 400.
    await expect(validate(make('2026-02-30'))).resolves.toHaveLength(1);
    await expect(validate(make('2026-13-01'))).resolves.toHaveLength(1);
  });
});
