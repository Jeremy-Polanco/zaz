import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { PushService } from '../notifications/push.service';
import { OrderStatus } from '../../entities/enums';
import type { Order } from '../../entities/order.entity';

/**
 * Customer-facing order tracking, dual channel:
 *
 *  - Push (Expo): every registered device, free, instant. Tapping deep-links
 *    into /orders/[orderId].
 *  - WhatsApp (Meta Cloud API utility template): {{1}} first name, {{2}} the
 *    status phrase below. Until WHATSAPP_ORDER_TEMPLATE_NAME is approved and
 *    configured, WhatsAppService.sendTemplate logs-and-skips, so this is safe
 *    to ship ahead of the Meta setup.
 *
 * Statuses with no entry (pending_validation — the customer themselves just
 * authorized payment in-app) intentionally send nothing.
 */
const STATUS_MESSAGES: Partial<Record<OrderStatus, string>> = {
  [OrderStatus.PENDING_QUOTE]:
    'recibimos tu pedido y lo estamos cotizando. Te avisamos en cuanto esté listo.',
  [OrderStatus.QUOTED]:
    'tu cotización está lista. Entra a la app para autorizar el pago y confirmar tu pedido.',
  [OrderStatus.CONFIRMED_BY_COLMADO]:
    'tu pedido fue confirmado y ya lo estamos preparando.',
  [OrderStatus.IN_DELIVERY_ROUTE]:
    '¡tu pedido va en camino! Pronto llega a tu puerta.',
  [OrderStatus.DELIVERED]:
    'tu pedido fue entregado. ¡Gracias por pedir con nosotros!',
  [OrderStatus.CANCELLED]:
    'tu pedido fue cancelado. Si no lo esperabas, escríbenos por aquí.',
};

@Injectable()
export class OrderNotificationsService {
  private readonly logger = new Logger(OrderNotificationsService.name);
  private readonly templateName: string | null;

  constructor(
    private readonly whatsapp: WhatsAppService,
    private readonly push: PushService,
    config: ConfigService,
  ) {
    this.templateName =
      config.get<string>('WHATSAPP_ORDER_TEMPLATE_NAME') ?? null;
  }

  /**
   * Fire-and-forget status update to the order's customer over both channels.
   * Callers pass the order AFTER the transition, with the `customer` relation
   * loaded (findOne does). Never throws and never blocks the calling flow.
   */
  notifyStatus(order: Order): void {
    const statusText = STATUS_MESSAGES[order.status];
    if (!statusText) return;

    // Push: standalone sentence (capitalize the shared phrase).
    if (order.customerId) {
      const body = statusText.charAt(0).toUpperCase() + statusText.slice(1);
      void this.push
        .sendToUser(order.customerId, 'Tu pedido Udash', body, {
          orderId: order.id,
        })
        .catch((err) =>
          this.logger.error(
            `order ${order.id} push notification (${order.status}) failed: ${
              (err as Error).message
            }`,
          ),
        );
    }

    // WhatsApp template: "Hola {{1}}, {{2}}".
    const phone = order.customer?.phone;
    if (!phone) return;
    const firstName =
      (order.customer?.fullName ?? '').trim().split(/\s+/)[0] || 'Hola';

    void this.whatsapp
      .sendTemplate(phone, this.templateName, [firstName, statusText])
      .catch((err) =>
        this.logger.error(
          `order ${order.id} WhatsApp status notification (${order.status}) failed: ${
            (err as Error).message
          }`,
        ),
      );
  }
}
