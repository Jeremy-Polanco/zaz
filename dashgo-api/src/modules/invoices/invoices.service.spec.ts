/**
 * Unit specs para InvoicesService.
 *
 * Foco: la factura es un SNAPSHOT de la orden. Cuando apareció el recargo por
 * distancia (`orders.delivery_surcharge`, 2026-09-14) la factura se quedó sin
 * esa columna, así que sus renglones dejaron de sumar el total: subtotal −
 * puntos + envío + impuesto + propina ≠ total. Estos tests fijan que la
 * factura arrastre el recargo tanto al crearse como al leerse.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { Counter, Invoice, Order } from '../../entities';
import { OrderStatus, PaymentMethod, UserRole } from '../../entities/enums';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { InvoicesService } from './invoices.service';

/**
 * Orden lejana: $10 de productos, $5 de envío y $7 de recargo por distancia.
 * El recargo es la plata que la factura vieja perdía.
 */
function fakeOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: 'order-1',
    customerId: 'user-1',
    customerNameSnapshot: null,
    customerPhoneSnapshot: null,
    status: OrderStatus.CONFIRMED_BY_COLMADO,
    deliveryAddress: { text: '123 Test St' },
    subtotal: '10.00',
    pointsRedeemed: '0.00',
    shipping: '5.00',
    deliverySurcharge: '7.00',
    scheduledDeliveryDate: null,
    tax: '1.95',
    taxRate: '0.08887',
    taxableSubtotal: '22.00',
    tip: '1.50',
    totalAmount: '25.45',
    paymentMethod: PaymentMethod.CASH,
    createdAt: new Date('2026-09-14T12:00:00.000Z'),
    items: [],
    customer: {
      id: 'user-1',
      fullName: 'Ana María Gómez',
      phone: '+12015550123',
    } as never,
    ...overrides,
  } as unknown as Order;
}

function fakeInvoice(overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: 'inv-1',
    orderId: 'order-1',
    invoiceNumber: 'INV-2026-000001',
    subtotal: '10.00',
    pointsRedeemed: '0.00',
    shipping: '5.00',
    deliverySurcharge: '7.00',
    tax: '1.95',
    taxRate: '0.08887',
    tip: '1.50',
    total: '25.45',
    createdAt: new Date('2026-09-14T12:00:00.000Z'),
    ...overrides,
  } as unknown as Invoice;
}

const superAdmin: AuthenticatedUser = {
  id: 'admin-1',
  email: 'admin@udash.test',
  role: UserRole.SUPER_ADMIN_DELIVERY,
};

const cents = (value: string) => Math.round(parseFloat(value) * 100);

describe('InvoicesService', () => {
  let service: InvoicesService;
  let invoicesRepo: jest.Mocked<Repository<Invoice>>;
  let ordersRepo: jest.Mocked<Repository<Order>>;
  let dataSource: jest.Mocked<DataSource>;

  // Manager de la transacción: devuelve un repo distinto por entidad, igual que
  // el EntityManager real.
  let txInvoices: { findOne: jest.Mock; create: jest.Mock; save: jest.Mock };
  let txOrders: { findOne: jest.Mock };
  let manager: EntityManager;

  beforeEach(async () => {
    invoicesRepo = {
      findOne: jest.fn(),
    } as unknown as jest.Mocked<Repository<Invoice>>;
    ordersRepo = {
      findOne: jest.fn(),
    } as unknown as jest.Mocked<Repository<Order>>;

    txInvoices = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((data: Partial<Invoice>) => ({ id: 'inv-1', ...data })),
      save: jest.fn((entity: Invoice) => Promise.resolve(entity)),
    };
    txOrders = { findOne: jest.fn() };
    const txCounters = {
      findOne: jest.fn().mockResolvedValue({ key: 'invoice-2026', value: 0 }),
      save: jest.fn((c: Counter) => Promise.resolve(c)),
      createQueryBuilder: jest.fn(),
    };

    manager = {
      getRepository: jest.fn((entity: unknown) => {
        if (entity === Invoice) return txInvoices;
        if (entity === Order) return txOrders;
        return txCounters;
      }),
    } as unknown as EntityManager;

    dataSource = {
      transaction: jest.fn(
        (run: (mgr: EntityManager) => Promise<unknown>) => run(manager),
      ),
    } as unknown as jest.Mocked<DataSource>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InvoicesService,
        { provide: getRepositoryToken(Invoice), useValue: invoicesRepo },
        { provide: getRepositoryToken(Order), useValue: ordersRepo },
        { provide: DataSource, useValue: dataSource },
      ],
    }).compile();

    service = module.get(InvoicesService);
  });

  describe('createForOrder — snapshot del recargo por distancia', () => {
    it('congela el recargo de la orden en la factura', async () => {
      txOrders.findOne.mockResolvedValue(fakeOrder());

      await service.createForOrder('order-1');

      const created = txInvoices.create.mock.calls[0][0] as Record<
        string,
        unknown
      >;
      expect(created.deliverySurcharge).toBe('7.00');
      expect(created.shipping).toBe('5.00');
      expect(created.total).toBe('25.45');
    });

    it('los renglones de la factura SUMAN el total', async () => {
      // Ésta es la razón de ser de la columna: sin el recargo, la factura de un
      // cliente lejano mostraba $7 menos de los que efectivamente pagó.
      txOrders.findOne.mockResolvedValue(fakeOrder());

      await service.createForOrder('order-1');

      const i = txInvoices.create.mock.calls[0][0] as Record<string, string>;
      const sum =
        cents(i.subtotal) -
        cents(i.pointsRedeemed) +
        cents(i.shipping) +
        cents(i.deliverySurcharge) +
        cents(i.tax) +
        cents(i.tip);
      expect(sum).toBe(cents(i.total));
    });

    it('una orden sin recargo sigue snapshotteando 0', async () => {
      txOrders.findOne.mockResolvedValue(
        fakeOrder({
          deliverySurcharge: '0.00',
          tax: '1.33',
          totalAmount: '17.83',
        }),
      );

      await service.createForOrder('order-1');

      const created = txInvoices.create.mock.calls[0][0] as Record<
        string,
        unknown
      >;
      expect(created.deliverySurcharge).toBe('0.00');
    });
  });

  describe('getByOrderId — el recargo sale en la respuesta', () => {
    it('devuelve deliverySurcharge junto al resto de los montos', async () => {
      ordersRepo.findOne.mockResolvedValue(fakeOrder());
      invoicesRepo.findOne.mockResolvedValue(fakeInvoice());

      const view = await service.getByOrderId('order-1', superAdmin);

      expect(view.deliverySurcharge).toBe('7.00');
      expect(view.shipping).toBe('5.00');
      expect(view.total).toBe('25.45');
    });

    it('lo lee de la FACTURA y no de la orden (es un snapshot)', async () => {
      // Si mañana el admin re-cotiza la orden, la factura ya emitida no puede
      // cambiar de monto: es el documento fiscal.
      ordersRepo.findOne.mockResolvedValue(
        fakeOrder({ deliverySurcharge: '99.00' }),
      );
      invoicesRepo.findOne.mockResolvedValue(
        fakeInvoice({ deliverySurcharge: '7.00' }),
      );

      const view = await service.getByOrderId('order-1', superAdmin);

      expect(view.deliverySurcharge).toBe('7.00');
    });
  });
});
