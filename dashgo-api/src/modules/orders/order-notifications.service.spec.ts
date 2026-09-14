/**
 * Zona horaria real del negocio: el día de reparto se arma con componentes
 * locales, y con un CI en UTC el caso del corrimiento no se notaría.
 */
process.env.TZ = 'America/New_York';

import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { OrderStatus } from '../../entities/enums';
import type { Order } from '../../entities/order.entity';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { PushService } from '../notifications/push.service';
import { OrderNotificationsService } from './order-notifications.service';

describe('OrderNotificationsService', () => {
  let service: OrderNotificationsService;
  let whatsapp: { sendTemplate: jest.Mock };
  let push: { sendToUser: jest.Mock };

  beforeEach(async () => {
    whatsapp = { sendTemplate: jest.fn().mockResolvedValue(true) };
    push = { sendToUser: jest.fn().mockResolvedValue(1) };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrderNotificationsService,
        { provide: WhatsAppService, useValue: whatsapp },
        { provide: PushService, useValue: push },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) =>
              key === 'WHATSAPP_ORDER_TEMPLATE_NAME' ? 'order_update_es' : undefined,
            ),
          },
        },
      ],
    }).compile();
    service = module.get(OrderNotificationsService);
  });

  const DEFAULT_CUSTOMER = {
    phone: '+12015550123',
    fullName: 'Ana María Gómez',
  };

  function orderWith(
    status: OrderStatus,
    customer: unknown = DEFAULT_CUSTOMER,
  ): Order {
    return {
      id: 'order-1',
      status,
      customer,
      customerId: 'customer-1',
    } as unknown as Order;
  }

  it.each([
    OrderStatus.PENDING_QUOTE,
    OrderStatus.QUOTED,
    OrderStatus.CONFIRMED_BY_COLMADO,
    OrderStatus.IN_DELIVERY_ROUTE,
    OrderStatus.DELIVERED,
    OrderStatus.CANCELLED,
  ])('sends a template message for %s with the first name', async (status) => {
    service.notifyStatus(orderWith(status));
    await Promise.resolve();
    expect(whatsapp.sendTemplate).toHaveBeenCalledTimes(1);
    const [phone, template, params] = whatsapp.sendTemplate.mock.calls[0] as [
      string,
      string,
      string[],
    ];
    expect(phone).toBe('+12015550123');
    expect(template).toBe('order_update_es');
    expect(params[0]).toBe('Ana');
    expect(params[1].length).toBeGreaterThan(0);
  });

  it('sends nothing for pending_validation (customer just paid in-app)', async () => {
    service.notifyStatus(orderWith(OrderStatus.PENDING_VALIDATION));
    await Promise.resolve();
    expect(whatsapp.sendTemplate).not.toHaveBeenCalled();
    expect(push.sendToUser).not.toHaveBeenCalled();
  });

  it('sends a push with a capitalized standalone body and the orderId for deep-linking', async () => {
    service.notifyStatus(orderWith(OrderStatus.IN_DELIVERY_ROUTE));
    await Promise.resolve();
    expect(push.sendToUser).toHaveBeenCalledTimes(1);
    const [userId, title, body, data] = push.sendToUser.mock.calls[0] as [
      string,
      string,
      string,
      Record<string, string>,
    ];
    expect(userId).toBe('customer-1');
    expect(title).toBe('Tu pedido Udash');
    expect(body.charAt(0)).toBe(body.charAt(0).toUpperCase());
    expect(data).toEqual({ orderId: 'order-1' });
  });

  it('still pushes when the phone is missing (push and WhatsApp are independent)', async () => {
    service.notifyStatus(
      orderWith(OrderStatus.DELIVERED, { phone: null, fullName: 'X' }),
    );
    await Promise.resolve();
    expect(push.sendToUser).toHaveBeenCalledTimes(1);
    expect(whatsapp.sendTemplate).not.toHaveBeenCalled();
  });

  it('sends nothing when the customer relation or phone is missing', async () => {
    service.notifyStatus(orderWith(OrderStatus.DELIVERED, null));
    service.notifyStatus(
      orderWith(OrderStatus.DELIVERED, { phone: null, fullName: 'X' }),
    );
    await Promise.resolve();
    expect(whatsapp.sendTemplate).not.toHaveBeenCalled();
  });

  it('never throws when the send rejects (fire-and-forget)', async () => {
    whatsapp.sendTemplate.mockRejectedValue(new Error('Meta down'));
    expect(() => service.notifyStatus(orderWith(OrderStatus.DELIVERED))).not.toThrow();
    // allow the floating promise's catch to run
    await new Promise((r) => setImmediate(r));
  });

  // ---------------------------------------------------------------------------
  // notifyScheduledDelivery — "te toca el miércoles"
  //
  // Pedido del dueño (2026-09-14): el admin asigna el DÍA de entrega y el
  // cliente se tiene que enterar. Mismos dos canales que el cambio de estado.
  // ---------------------------------------------------------------------------

  function scheduledOrder(
    scheduledDeliveryDate: string | null,
    customer: unknown = DEFAULT_CUSTOMER,
  ): Order {
    return {
      id: 'order-1',
      status: OrderStatus.QUOTED,
      customer,
      customerId: 'customer-1',
      scheduledDeliveryDate,
    } as unknown as Order;
  }

  describe('notifyScheduledDelivery', () => {
    it('pushea el día en español con el orderId y la fecha en data', async () => {
      service.notifyScheduledDelivery(scheduledOrder('2026-09-16'));
      await Promise.resolve();

      expect(push.sendToUser).toHaveBeenCalledTimes(1);
      const [userId, title, body, data] = push.sendToUser.mock.calls[0] as [
        string,
        string,
        string,
        Record<string, string>,
      ];
      expect(userId).toBe('customer-1');
      expect(title).toBe('Tu pedido Udash');
      expect(body).toBe(
        'Tu entrega quedó programada para el miércoles 16 de septiembre.',
      );
      // La app usa `scheduledDeliveryDate` para abrir el pedido en el día.
      expect(data).toEqual({
        orderId: 'order-1',
        scheduledDeliveryDate: '2026-09-16',
      });
    });

    it('NO corre el día por la zona horaria', async () => {
      // El bug clásico: new Date('2026-09-16') es medianoche UTC → "martes 15"
      // en America/New_York. El cliente se presentaría el día equivocado.
      service.notifyScheduledDelivery(scheduledOrder('2026-09-16'));
      await Promise.resolve();
      const body = push.sendToUser.mock.calls[0][2] as string;
      expect(body).toContain('miércoles 16');
      expect(body).not.toContain('martes 15');
    });

    it('manda el template de WhatsApp con el nombre y la frase en minúscula', async () => {
      service.notifyScheduledDelivery(scheduledOrder('2026-09-16'));
      await Promise.resolve();

      expect(whatsapp.sendTemplate).toHaveBeenCalledTimes(1);
      const [phone, template, params] = whatsapp.sendTemplate.mock.calls[0] as [
        string,
        string,
        string[],
      ];
      expect(phone).toBe('+12015550123');
      expect(template).toBe('order_update_es');
      expect(params[0]).toBe('Ana');
      // {{2}} entra después de "Hola {{1}}, " → arranca en minúscula.
      expect(params[1]).toBe(
        'tu entrega quedó programada para el miércoles 16 de septiembre.',
      );
    });

    it('no manda nada cuando el pedido no tiene día asignado', async () => {
      service.notifyScheduledDelivery(scheduledOrder(null));
      await Promise.resolve();
      expect(push.sendToUser).not.toHaveBeenCalled();
      expect(whatsapp.sendTemplate).not.toHaveBeenCalled();
    });

    it('pushea igual sin teléfono (los canales son independientes)', async () => {
      service.notifyScheduledDelivery(
        scheduledOrder('2026-09-16', { phone: null, fullName: 'X' }),
      );
      await Promise.resolve();
      expect(push.sendToUser).toHaveBeenCalledTimes(1);
      expect(whatsapp.sendTemplate).not.toHaveBeenCalled();
    });

    it('nunca tira aunque fallen los dos canales (fire-and-forget)', async () => {
      push.sendToUser.mockRejectedValue(new Error('Expo down'));
      whatsapp.sendTemplate.mockRejectedValue(new Error('Meta down'));
      expect(() =>
        service.notifyScheduledDelivery(scheduledOrder('2026-09-16')),
      ).not.toThrow();
      await new Promise((r) => setImmediate(r));
    });
  });
});
