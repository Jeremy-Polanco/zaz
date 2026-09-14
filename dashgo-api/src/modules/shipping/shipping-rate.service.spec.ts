/**
 * Unit specs for ShippingRateService — la tarifa plana de envío editable.
 *
 * Pedido del dueño (2026-09-14): "sería bueno que el super admin pueda
 * modificar la tasa general del delivery". La tarifa dejó de ser una constante
 * de código y vive en `app_settings.flat_shipping_cents`.
 *
 * El foco de estos tests es la LECTURA defensiva: la fila la escribe un humano
 * desde el panel y el valor es `text`, así que cualquier cosa puede terminar
 * guardada. Un envío en NaN se propagaría a la cotización, al impuesto y al
 * total de la orden — preferimos caer al default antes que cobrar basura.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppSetting } from '../../entities/app-setting.entity';
import { DEFAULT_FLAT_SHIPPING_CENTS } from '../../common/shipping';
import {
  SETTING_FLAT_SHIPPING_CENTS,
  ShippingRateService,
} from './shipping-rate.service';

function makeSettingsRepoMock(): jest.Mocked<Repository<AppSetting>> {
  return {
    findOne: jest.fn(),
    save: jest.fn((row: Partial<AppSetting>) => Promise.resolve(row)),
    create: jest.fn((row: Partial<AppSetting>) => row),
  } as unknown as jest.Mocked<Repository<AppSetting>>;
}

function fakeSetting(value: string): AppSetting {
  return {
    key: SETTING_FLAT_SHIPPING_CENTS,
    value,
    updatedAt: new Date('2026-09-14T00:00:00.000Z'),
  };
}

describe('ShippingRateService', () => {
  let service: ShippingRateService;
  let settings: jest.Mocked<Repository<AppSetting>>;

  beforeEach(async () => {
    settings = makeSettingsRepoMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ShippingRateService,
        { provide: getRepositoryToken(AppSetting), useValue: settings },
      ],
    }).compile();

    service = module.get<ShippingRateService>(ShippingRateService);
  });

  describe('getFlatShippingCents', () => {
    it('sin fila guardada devuelve la tarifa por defecto', async () => {
      // No hace falta migración que siembre el valor: la ausencia de fila ES
      // "el admin todavía no tocó nada", y eso significa los $5 de siempre.
      settings.findOne.mockResolvedValue(null);

      await expect(service.getFlatShippingCents()).resolves.toBe(
        DEFAULT_FLAT_SHIPPING_CENTS,
      );
      expect(settings.findOne).toHaveBeenCalledWith({
        where: { key: SETTING_FLAT_SHIPPING_CENTS },
      });
    });

    it('devuelve la tarifa que dejó el admin', async () => {
      settings.findOne.mockResolvedValue(fakeSetting('700'));

      await expect(service.getFlatShippingCents()).resolves.toBe(700);
    });

    it('acepta 0 — el admin puede poner el envío en gratis', async () => {
      // Ojo con el falsy: 0 es una tarifa VÁLIDA, no "sin configurar". Si se
      // chequeara con `if (!parsed)` el envío gratis se volvería $5.
      settings.findOne.mockResolvedValue(fakeSetting('0'));

      await expect(service.getFlatShippingCents()).resolves.toBe(0);
    });

    it.each([['abc'], [''], ['   '], ['5.50'], ['-100'], ['NaN']])(
      'ignora el valor corrupto %p y cae al default',
      async (value) => {
        settings.findOne.mockResolvedValue(fakeSetting(value));

        await expect(service.getFlatShippingCents()).resolves.toBe(
          DEFAULT_FLAT_SHIPPING_CENTS,
        );
      },
    );
  });

  describe('setFlatShippingCents', () => {
    it('persiste la tarifa como texto y devuelve el número guardado', async () => {
      // `save` sobre la PK hace upsert: la primera vez inserta la fila, las
      // siguientes la pisan. Por eso no hace falta migración de seed.
      await expect(service.setFlatShippingCents(700)).resolves.toBe(700);

      expect(settings.save).toHaveBeenCalledWith(
        expect.objectContaining({
          key: SETTING_FLAT_SHIPPING_CENTS,
          value: '700',
        }),
      );
    });

    it('guardar y leer de vuelta devuelve lo mismo', async () => {
      await service.setFlatShippingCents(1250);
      const saved = (settings.save as jest.Mock).mock
        .calls[0][0] as Partial<AppSetting>;
      settings.findOne.mockResolvedValue(fakeSetting(saved.value!));

      await expect(service.getFlatShippingCents()).resolves.toBe(1250);
    });
  });
});
