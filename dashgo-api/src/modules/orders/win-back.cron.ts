import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../../entities/user.entity';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { PushService } from '../notifications/push.service';

/**
 * Win-back reminder — customers who haven't ordered in 8+ days get ONE nudge
 * per lapse, over both channels: push (Expo, free) and WhatsApp (marketing
 * template WHATSAPP_WINBACK_TEMPLATE_NAME, one body variable: first name).
 *
 * "Once per lapse": a user is reminded only when their last reminder predates
 * their last order — i.e. they ordered again after the previous nudge and then
 * lapsed again. We deliberately do NOT re-remind every 8 days; an unanswered
 * marketing ping repeated forever is spam and risks Meta quality-rating
 * penalties on the WABA.
 *
 * Runs daily at 11:00 America/New_York (brand + delivery ops are in NJ).
 * Capped per run to stay inside Meta's business-initiated conversation tiers.
 */
const INACTIVE_DAYS = 8;
const MAX_SENDS_PER_RUN = 100;

@Injectable()
export class WinBackCron {
  private readonly logger = new Logger(WinBackCron.name);
  private readonly templateName: string | null;

  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly whatsapp: WhatsAppService,
    private readonly push: PushService,
    config: ConfigService,
  ) {
    this.templateName =
      config.get<string>('WHATSAPP_WINBACK_TEMPLATE_NAME') ?? null;
  }

  @Cron('0 11 * * *', { timeZone: 'America/New_York' })
  async runDaily(): Promise<{ candidates: number; sent: number }> {
    // Lapsed clients: last non-cancelled order is 8+ days old, phone on file,
    // and not yet reminded for THIS lapse (reminder predates the last order).
    const rows: Array<{
      id: string;
      phone: string;
      full_name: string;
      last_order: Date;
    }> = await this.users.query(
      `
      SELECT u.id, u.phone, u.full_name, MAX(o.created_at) AS last_order
      FROM users u
      JOIN orders o ON o.customer_id = u.id AND o.status != 'cancelled'
      WHERE u.role = 'client'
        AND u.phone IS NOT NULL
      GROUP BY u.id, u.phone, u.full_name, u.last_order_reminder_at
      HAVING MAX(o.created_at) <= now() - ($1 || ' days')::interval
         AND (
           u.last_order_reminder_at IS NULL
           OR u.last_order_reminder_at < MAX(o.created_at)
         )
      ORDER BY MAX(o.created_at) ASC
      LIMIT $2
      `,
      [String(INACTIVE_DAYS), MAX_SENDS_PER_RUN],
    );

    let sent = 0;
    for (const row of rows) {
      const firstName =
        (row.full_name ?? '').trim().split(/\s+/)[0] || 'Hola';

      // Push first (free, no template gate)...
      let pushAccepted = 0;
      try {
        pushAccepted = await this.push.sendToUser(
          row.id,
          `${firstName}, te extrañamos 👋`,
          'Hace más de una semana que no pides en Udash. Entra y pide lo de siempre 🛒',
        );
      } catch (err) {
        this.logger.error(
          `WinBackCron: push failed for user ${row.id}: ${(err as Error).message}`,
        );
      }

      // ...then WhatsApp (skips itself while the template isn't configured).
      let whatsappDelivered = false;
      try {
        whatsappDelivered = await this.whatsapp.sendTemplate(
          row.phone,
          this.templateName,
          [firstName],
        );
      } catch (err) {
        this.logger.error(
          `WinBackCron: WhatsApp failed for user ${row.id}: ${(err as Error).message}`,
        );
      }

      // Stamp only when at least one channel actually took the message, so a
      // user with no devices and no WhatsApp template retries tomorrow.
      if (pushAccepted > 0 || whatsappDelivered) {
        await this.users.update(row.id, { lastOrderReminderAt: new Date() });
        sent += 1;
      }
    }

    this.logger.log(
      `WinBackCron: ${rows.length} lapsed customer(s) found, ${sent} reminded`,
    );
    return { candidates: rows.length, sent };
  }
}
