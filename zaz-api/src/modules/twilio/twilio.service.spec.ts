/**
 * Unit tests for TwilioService — sendOrderNotificationSms
 */

import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { TwilioService } from './twilio.service';
import { Order } from '../../entities/order.entity';
import { User } from '../../entities/user.entity';

// Mock the twilio library so the service constructor doesn't attempt a real Twilio init
jest.mock('twilio', () => {
  const ctor = jest.fn().mockImplementation(() => ({
    messages: { create: jest.fn() },
  }));
  return ctor;
});

function makeOrder(overrides: Partial<Order> = {}): Order {
  const customer = { fullName: 'Juan García' } as User;
  return {
    id: '550e8400-e29b-41d4-a716-446655440000',
    customerId: 'user-1',
    customer,
    status: 'PENDING_QUOTE',
    deliveryAddress: { text: 'Calle Duarte 45' } as never,
    subtotal: '35.00',
    pointsRedeemed: '0.00',
    shipping: '0.00',
    tax: '0.00',
    taxRate: '0.08887',
    totalAmount: '35.50',
    creditApplied: '0.00',
    paymentMethod: 'CASH' as never,
    stripePaymentIntentId: null,
    paidAt: null,
    quotedAt: null,
    authorizedAt: null,
    capturedAt: null,
    wasSubscriberAtQuote: false,
    createdAt: new Date(),
    items: [],
    ...overrides,
  } as unknown as Order;
}

describe('TwilioService — sendOrderNotificationSms', () => {
  let service: TwilioService;
  let sendSmsSpy: jest.SpyInstance;

  function buildService(numbers: string[]): TwilioService {
    const configService = {
      get: jest.fn((key: string) => {
        if (key === 'ORDER_SMS_NOTIFY_NUMBERS') return numbers;
        if (key === 'TWILIO_ACCOUNT_SID') return 'ACtest';
        if (key === 'TWILIO_API_KEY_SID') return 'SKtest';
        if (key === 'TWILIO_API_KEY_SECRET') return 'secret';
        if (key === 'TWILIO_FROM_NUMBER') return '+15550000000';
        return undefined;
      }),
    } as unknown as ConfigService;

    return new TwilioService(configService);
  }

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TwilioService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'ORDER_SMS_NOTIFY_NUMBERS') return [];
              return undefined;
            }),
          },
        },
      ],
    }).compile();

    service = module.get<TwilioService>(TwilioService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // Empty numbers — no sendSms calls
  // -------------------------------------------------------------------------

  it('does not call sendSms when ORDER_SMS_NOTIFY_NUMBERS is empty', async () => {
    const svc = buildService([]);
    sendSmsSpy = jest.spyOn(svc, 'sendSms');

    await svc.sendOrderNotificationSms(makeOrder());

    expect(sendSmsSpy).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Single number — exactly one sendSms call
  // -------------------------------------------------------------------------

  it('calls sendSms exactly once when one number is configured', async () => {
    const svc = buildService(['+19172541473']);
    sendSmsSpy = jest.spyOn(svc, 'sendSms').mockResolvedValue(undefined);

    await svc.sendOrderNotificationSms(makeOrder());

    expect(sendSmsSpy).toHaveBeenCalledTimes(1);
    expect(sendSmsSpy).toHaveBeenCalledWith('+19172541473', expect.any(String));
  });

  // -------------------------------------------------------------------------
  // Multiple numbers — one call per number with the same body
  // -------------------------------------------------------------------------

  it('calls sendSms once per number with the same body when two numbers are configured', async () => {
    const svc = buildService(['+19172541473', '+12019081426']);
    sendSmsSpy = jest.spyOn(svc, 'sendSms').mockResolvedValue(undefined);

    await svc.sendOrderNotificationSms(makeOrder());

    expect(sendSmsSpy).toHaveBeenCalledTimes(2);
    const [firstBody] = (sendSmsSpy.mock.calls[0] as [string, string]).slice(1);
    const [secondBody] = (sendSmsSpy.mock.calls[1] as [string, string]).slice(1);
    expect(firstBody).toBe(secondBody);
  });

  // -------------------------------------------------------------------------
  // SMS body format assertions
  // -------------------------------------------------------------------------

  it('builds body with ZAZ prefix and shortId (last 8 hex chars, no dashes)', async () => {
    const svc = buildService(['+19172541473']);
    sendSmsSpy = jest.spyOn(svc, 'sendSms').mockResolvedValue(undefined);

    // UUID: 550e8400-e29b-41d4-a716-446655440000
    // Stripped: 550e8400e29b41d4a716446655440000 → last 8 → "55440000"
    await svc.sendOrderNotificationSms(makeOrder());

    const body = (sendSmsSpy.mock.calls[0] as [string, string])[1];
    expect(body).toMatch(/^ZAZ: Pedido #55440000 —/);
  });

  it('uses $totalAmount directly (not divided by 100)', async () => {
    const svc = buildService(['+19172541473']);
    sendSmsSpy = jest.spyOn(svc, 'sendSms').mockResolvedValue(undefined);

    await svc.sendOrderNotificationSms(makeOrder({ totalAmount: '35.50' }));

    const body = (sendSmsSpy.mock.calls[0] as [string, string])[1];
    expect(body).toContain('$35.50');
  });

  it('includes customer fullName in the body', async () => {
    const svc = buildService(['+19172541473']);
    sendSmsSpy = jest.spyOn(svc, 'sendSms').mockResolvedValue(undefined);

    await svc.sendOrderNotificationSms(
      makeOrder({ customer: { fullName: 'Juan García' } as User }),
    );

    const body = (sendSmsSpy.mock.calls[0] as [string, string])[1];
    expect(body).toContain('Juan García');
  });

  it('falls back to "Cliente" when customer.fullName is undefined', async () => {
    const svc = buildService(['+19172541473']);
    sendSmsSpy = jest.spyOn(svc, 'sendSms').mockResolvedValue(undefined);

    await svc.sendOrderNotificationSms(
      makeOrder({ customer: undefined as unknown as User }),
    );

    const body = (sendSmsSpy.mock.calls[0] as [string, string])[1];
    expect(body).toContain('Cliente');
  });

  // -------------------------------------------------------------------------
  // Address truncation
  // -------------------------------------------------------------------------

  it('does not truncate addresses of 40 chars or fewer', async () => {
    const shortAddress = 'Calle Duarte 45'; // 15 chars
    const svc = buildService(['+19172541473']);
    sendSmsSpy = jest.spyOn(svc, 'sendSms').mockResolvedValue(undefined);

    await svc.sendOrderNotificationSms(
      makeOrder({ deliveryAddress: { text: shortAddress } as never }),
    );

    const body = (sendSmsSpy.mock.calls[0] as [string, string])[1];
    expect(body).toContain(shortAddress);
    expect(body).not.toContain('...');
  });

  it('truncates addresses longer than 40 chars to 37 chars + "..."', async () => {
    // 49 chars
    const longAddress = 'Avenida Independencia 1234, Piso 3, Apartamento B';
    const svc = buildService(['+19172541473']);
    sendSmsSpy = jest.spyOn(svc, 'sendSms').mockResolvedValue(undefined);

    await svc.sendOrderNotificationSms(
      makeOrder({ deliveryAddress: { text: longAddress } as never }),
    );

    const body = (sendSmsSpy.mock.calls[0] as [string, string])[1];
    // First 37 chars + "..."
    expect(body).toContain('Avenida Independencia 1234, Piso 3, A...');
  });

  // -------------------------------------------------------------------------
  // Error handling: one number fails, second still called
  // -------------------------------------------------------------------------

  it('continues to the second number when the first sendSms rejects', async () => {
    const svc = buildService(['+19172541473', '+12019081426']);
    sendSmsSpy = jest
      .spyOn(svc, 'sendSms')
      .mockRejectedValueOnce(new Error('Twilio error'))
      .mockResolvedValueOnce(undefined);

    // Must NOT throw
    await expect(svc.sendOrderNotificationSms(makeOrder())).resolves.toBeUndefined();

    // Second number was still called
    expect(sendSmsSpy).toHaveBeenCalledTimes(2);
    expect(sendSmsSpy.mock.calls[1][0]).toBe('+12019081426');
  });

  it('does not throw when all sendSms calls reject', async () => {
    const svc = buildService(['+19172541473', '+12019081426']);
    sendSmsSpy = jest
      .spyOn(svc, 'sendSms')
      .mockRejectedValue(new Error('All fail'));

    await expect(svc.sendOrderNotificationSms(makeOrder())).resolves.toBeUndefined();
    expect(sendSmsSpy).toHaveBeenCalledTimes(2);
  });
});
