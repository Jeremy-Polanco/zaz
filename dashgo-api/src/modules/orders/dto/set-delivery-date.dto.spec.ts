import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SetDeliveryDateDto } from './set-delivery-date.dto';

const make = (value: unknown) =>
  plainToInstance(SetDeliveryDateDto, { scheduledDeliveryDate: value });

describe('SetDeliveryDateDto', () => {
  it('acepta un día en formato YYYY-MM-DD', async () => {
    const dto = make('2026-09-16');
    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it('acepta null — así el admin DESASIGNA el día', async () => {
    const dto = make(null);
    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it('rechaza una fecha con hora (es un DÍA, no un instante)', async () => {
    // Mandar un instante trae zona horaria y el día se corre en el borde de la
    // medianoche: el cliente vería un día distinto al que cargó el admin.
    const errors = await validate(make('2026-09-16T00:00:00.000Z'));
    expect(errors).toHaveLength(1);
    expect(errors[0].constraints).toHaveProperty('matches');
  });

  it('rechaza texto libre y formatos dados vuelta', async () => {
    await expect(validate(make('mañana'))).resolves.toHaveLength(1);
    await expect(validate(make('16-09-2026'))).resolves.toHaveLength(1);
  });

  it('rechaza un día con forma válida pero que NO existe en el calendario', async () => {
    // El regex sólo mira la forma. Sin esto, '2026-02-30' pasaba la validación,
    // Postgres lo rechazaba al escribir la columna `date` y el admin recibía un
    // 500 en vez de un 400 que le explicara el error (lo cazó el e2e).
    await expect(validate(make('2026-02-30'))).resolves.toHaveLength(1);
    await expect(validate(make('2026-13-01'))).resolves.toHaveLength(1);
    await expect(validate(make('2027-02-29'))).resolves.toHaveLength(1);
    await expect(validate(make('2026-04-31'))).resolves.toHaveLength(1);
  });

  it('acepta el 29 de febrero de un año bisiesto', async () => {
    await expect(validate(make('2028-02-29'))).resolves.toHaveLength(0);
  });

  it('rechaza que falte el campo — null y ausente no son lo mismo', async () => {
    // `null` es una orden explícita ("sacale el día"); ausente es un cliente
    // mal escrito, y no puede pasar como si fuese lo mismo.
    const errors = await validate(plainToInstance(SetDeliveryDateDto, {}));
    expect(errors).toHaveLength(1);
  });
});
