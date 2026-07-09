import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { OrderStatus } from '../../entities/enums';
import type { Order } from '../../entities/order.entity';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { OrderNotificationsService } from './order-notifications.service';

describe('OrderNotificationsService', () => {
  let service: OrderNotificationsService;
  let whatsapp: { sendTemplate: jest.Mock };

  beforeEach(async () => {
    whatsapp = { sendTemplate: jest.fn().mockResolvedValue(true) };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrderNotificationsService,
        { provide: WhatsAppService, useValue: whatsapp },
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
    return { id: 'order-1', status, customer } as unknown as Order;
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
});
