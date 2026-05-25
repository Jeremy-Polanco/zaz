import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { Counter, Invoice, Order } from '../../entities';
import { UserRole } from '../../entities/enums';
import { AuthenticatedUser } from '../../common/types/authenticated-user';

export interface InvoiceView {
  id: string;
  invoiceNumber: string;
  subtotal: string;
  pointsRedeemed: string;
  shipping: string;
  tax: string;
  taxRate: string;
  total: string;
  createdAt: Date;
  order: {
    id: string;
    status: string;
    deliveryAddress: unknown;
    paymentMethod: string;
    createdAt: Date;
  };
  customer: {
    id: string;
    fullName: string;
    phone: string | null;
  };
  items: {
    id: string;
    productId: string;
    productName: string;
    quantity: number;
    priceAtOrder: string;
    lineTotal: string;
  }[];
}

@Injectable()
export class InvoicesService {
  constructor(
    @InjectRepository(Invoice) private readonly invoices: Repository<Invoice>,
    @InjectRepository(Order) private readonly orders: Repository<Order>,
    private readonly dataSource: DataSource,
  ) {}

  async nextNumber(tx: EntityManager): Promise<string> {
    const repo = tx.getRepository(Counter);
    const year = new Date().getFullYear();
    const key = `invoice-${year}`;

    let counter = await repo.findOne({
      where: { key },
      lock: { mode: 'pessimistic_write' },
    });
    if (!counter) {
      await repo
        .createQueryBuilder()
        .insert()
        .values({ key, value: 0 })
        .orIgnore()
        .execute();
      counter = await repo.findOne({
        where: { key },
        lock: { mode: 'pessimistic_write' },
      });
      if (!counter) {
        throw new Error('No se pudo inicializar el contador de facturas');
      }
    }
    counter.value += 1;
    await repo.save(counter);
    return `INV-${year}-${counter.value.toString().padStart(6, '0')}`;
  }

  async createForOrder(
    orderId: string,
    tx?: EntityManager,
  ): Promise<Invoice> {
    const run = async (mgr: EntityManager) => {
      const invoiceRepo = mgr.getRepository(Invoice);
      const orderRepo = mgr.getRepository(Order);

      const existing = await invoiceRepo.findOne({ where: { orderId } });
      if (existing) return existing;

      const order = await orderRepo.findOne({ where: { id: orderId } });
      if (!order) {
        throw new NotFoundException('Pedido no encontrado');
      }

      const invoiceNumber = await this.nextNumber(mgr);
      const invoice = invoiceRepo.create({
        orderId: order.id,
        invoiceNumber,
        subtotal: order.subtotal,
        pointsRedeemed: order.pointsRedeemed,
        shipping: order.shipping,
        tax: order.tax,
        taxRate: order.taxRate,
        total: order.totalAmount,
      });
      return invoiceRepo.save(invoice);
    };

    if (tx) return run(tx);
    return this.dataSource.transaction(run);
  }

  async getByOrderId(
    orderId: string,
    currentUser: AuthenticatedUser,
  ): Promise<InvoiceView> {
    const order = await this.orders.findOne({
      where: { id: orderId },
      relations: ['customer', 'items', 'items.product'],
    });
    if (!order) throw new NotFoundException('Pedido no encontrado');

    if (
      currentUser.role !== UserRole.SUPER_ADMIN_DELIVERY &&
      order.customerId !== currentUser.id
    ) {
      throw new ForbiddenException('Sin acceso a esta factura');
    }

    const invoice = await this.invoices.findOne({ where: { orderId } });
    if (!invoice) {
      throw new NotFoundException(
        'La factura aún no fue generada para este pedido',
      );
    }

    return {
      id: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      subtotal: invoice.subtotal,
      pointsRedeemed: invoice.pointsRedeemed,
      shipping: invoice.shipping,
      tax: invoice.tax,
      taxRate: invoice.taxRate,
      total: invoice.total,
      createdAt: invoice.createdAt,
      order: {
        id: order.id,
        status: order.status,
        deliveryAddress: order.deliveryAddress,
        paymentMethod: order.paymentMethod,
        createdAt: order.createdAt,
      },
      customer: {
        id: order.customer.id,
        fullName: order.customer.fullName,
        phone: order.customer.phone,
      },
      items: (order.items ?? []).map((item) => {
        const priceCents = Math.round(parseFloat(item.priceAtOrder) * 100);
        const lineCents = priceCents * item.quantity;
        return {
          id: item.id,
          productId: item.productId,
          productName: item.product?.name ?? 'Producto',
          quantity: item.quantity,
          priceAtOrder: item.priceAtOrder,
          lineTotal: (lineCents / 100).toFixed(2),
        };
      }),
    };
  }
}
