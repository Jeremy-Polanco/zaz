/**
 * Unit specs for OrdersController — GET /orders?lat&lng.
 *
 * El controller es una capa fina: junta lat/lng (cuando llegan LOS DOS) en un
 * origen "device", se lo pasa a OrdersService.findAll, y expone qué origen
 * usó el service en el header `X-Dispatch-Origin` SIN tocar el shape del
 * array que devuelve (web y mobile dependen de eso).
 *
 * La validación de lat/lng en sí (rango, texto libre) está cubierta en
 * dto/list-orders-query.dto.spec.ts — acá sólo se prueba el forwarding.
 */

import { Test, TestingModule } from '@nestjs/testing';
import type { Response } from 'express';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { UserRole } from '../../entities/enums';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';

function fakeUser(role: UserRole = UserRole.SUPER_ADMIN_DELIVERY): AuthenticatedUser {
  return { id: 'staff-1', role, email: null };
}

function fakeResponse(): jest.Mocked<Response> {
  return { setHeader: jest.fn() } as unknown as jest.Mocked<Response>;
}

describe('OrdersController — GET /orders', () => {
  let controller: OrdersController;
  let orders: { findAll: jest.Mock };

  beforeEach(async () => {
    orders = {
      findAll: jest.fn().mockResolvedValue({ orders: [], originSource: 'none' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [OrdersController],
      providers: [{ provide: OrdersService, useValue: orders }],
    }).compile();

    controller = module.get<OrdersController>(OrdersController);
  });

  it('con lat y lng → arma el origen "device" y se lo pasa al service', async () => {
    const res = fakeResponse();

    await controller.findAll({ lat: 18.4861, lng: -69.9312 }, fakeUser(), res);

    expect(orders.findAll).toHaveBeenCalledWith(fakeUser(), {
      origin: { lat: 18.4861, lng: -69.9312 },
    });
  });

  it('sin query → no manda origen "device", deja que el service resuelva el fallback', async () => {
    const res = fakeResponse();

    await controller.findAll({}, fakeUser(), res);

    expect(orders.findAll).toHaveBeenCalledWith(fakeUser(), {
      origin: undefined,
    });
  });

  it('con sólo lat (falta lng) → tampoco arma origen "device"', async () => {
    const res = fakeResponse();

    await controller.findAll({ lat: 18.4861 }, fakeUser(), res);

    expect(orders.findAll).toHaveBeenCalledWith(fakeUser(), {
      origin: undefined,
    });
  });

  it('devuelve el array de orders tal cual — el shape no cambia', async () => {
    const fakeOrders = [{ id: 'o1' }, { id: 'o2' }];
    orders.findAll.mockResolvedValue({
      orders: fakeOrders,
      originSource: 'device',
    });
    const res = fakeResponse();

    const result = await controller.findAll(
      { lat: 1, lng: 2 },
      fakeUser(),
      res,
    );

    expect(result).toBe(fakeOrders);
  });

  it.each([
    ['device', 'device'],
    ['saved', 'saved'],
    ['none', 'none'],
  ])(
    'originSource "%s" → header X-Dispatch-Origin: %s',
    async (originSource, expectedHeader) => {
      orders.findAll.mockResolvedValue({ orders: [], originSource });
      const res = fakeResponse();

      await controller.findAll({}, fakeUser(), res);

      expect(res.setHeader).toHaveBeenCalledWith(
        'X-Dispatch-Origin',
        expectedHeader,
      );
    },
  );

  it('cliente (originSource null) → NO manda el header', async () => {
    orders.findAll.mockResolvedValue({ orders: [], originSource: null });
    const res = fakeResponse();

    await controller.findAll({}, fakeUser(UserRole.CLIENT), res);

    expect(res.setHeader).not.toHaveBeenCalled();
  });
});
