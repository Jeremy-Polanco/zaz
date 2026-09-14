/**
 * Unit specs for ShippingController — el contrato de la tarifa de envío.
 *
 * Web y mobile se están construyendo EN PARALELO contra este contrato, así que
 * lo que se testea acá no es sólo la delegación sino los METADATOS de guardia:
 *
 *   GET  /shipping/rate → @Public()  — el checkout de un invitado tiene que
 *                                      poder mostrar el envío antes del login.
 *   PUT  /shipping/rate → @Roles(SUPER_ADMIN_DELIVERY) — la tarifa es plata.
 *
 * Un `@Public()` de más o de menos no rompe ningún test de servicio: se ve
 * recién en producción, como un 401 en el catálogo o —peor— un cliente
 * cambiándose el envío. Por eso se afirma sobre el Reflector.
 */

import { Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../entities/enums';
import { ShippingController } from './shipping.controller';
import { ShippingRateService } from './shipping-rate.service';
import { ShippingService } from './shipping.service';

describe('ShippingController — tarifa de envío', () => {
  let controller: ShippingController;
  let shipping: { computeQuote: jest.Mock };
  let rate: {
    getFlatShippingCents: jest.Mock;
    setFlatShippingCents: jest.Mock;
  };
  const reflector = new Reflector();

  beforeEach(async () => {
    shipping = {
      computeQuote: jest
        .fn()
        .mockResolvedValue({ shippingCents: 300, miles: 2 }),
    };
    rate = {
      getFlatShippingCents: jest.fn().mockResolvedValue(500),
      setFlatShippingCents: jest.fn((cents: number) => Promise.resolve(cents)),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ShippingController],
      providers: [
        { provide: ShippingService, useValue: shipping },
        { provide: ShippingRateService, useValue: rate },
      ],
    }).compile();

    controller = module.get<ShippingController>(ShippingController);
  });

  it('GET rate devuelve la tarifa vigente', async () => {
    rate.getFlatShippingCents.mockResolvedValue(700);

    await expect(controller.getRate()).resolves.toEqual({
      shippingCents: 700,
    });
  });

  it('PUT rate guarda la tarifa y devuelve la nueva', async () => {
    await expect(controller.setRate({ shippingCents: 700 })).resolves.toEqual({
      shippingCents: 700,
    });
    expect(rate.setFlatShippingCents).toHaveBeenCalledWith(700);
  });

  it('GET rate es público — el invitado ve el envío antes de loguearse', () => {
    const isPublic = reflector.get<boolean>(
      IS_PUBLIC_KEY,
      ShippingController.prototype.getRate,
    );

    expect(isPublic).toBe(true);
  });

  it('PUT rate es sólo del super admin', () => {
    const roles = reflector.get<UserRole[]>(
      ROLES_KEY,
      ShippingController.prototype.setRate,
    );

    expect(roles).toEqual([UserRole.SUPER_ADMIN_DELIVERY]);
  });

  it('PUT rate NO es público', () => {
    const isPublic = reflector.get<boolean>(
      IS_PUBLIC_KEY,
      ShippingController.prototype.setRate,
    );

    expect(isPublic).toBeUndefined();
  });

  it('POST quote sigue sin ser público ni exclusivo del super admin', () => {
    // La cotización por distancia no cambió: la usa el admin al cotizar, con
    // sesión, y no lleva @Roles propio.
    expect(
      reflector.get<boolean>(IS_PUBLIC_KEY, ShippingController.prototype.quote),
    ).toBeUndefined();
    expect(
      reflector.get<UserRole[]>(ROLES_KEY, ShippingController.prototype.quote),
    ).toBeUndefined();
  });
});
