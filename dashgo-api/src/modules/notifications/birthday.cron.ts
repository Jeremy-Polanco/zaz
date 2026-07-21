import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../../entities/user.entity';
import { PushService } from './push.service';
import { AppSettingsService } from './app-settings.service';
import { WhatsAppService } from '../whatsapp/whatsapp.service';

/** Days of gift-preparation lead time for the admin heads-up. */
const HEADS_UP_DAYS = 3;

/**
 * Daily birthday cron (09:00 America/New_York, before the 11:00 win-back):
 *
 *  1. GREETING — every client whose date_of_birth month/day is today gets a
 *     push with the admin-configured copy (Notificar panel → "Mensaje de
 *     cumpleaños"; `{nombre}` is replaced with the customer's first name).
 *     Feb 29 birthdays are greeted on Feb 28 in non-leap years — never
 *     skipped.
 *
 *  2. ADMIN HEADS-UP — the owner wants gift lead time: every super admin is
 *     told which clients turn a year older in HEADS_UP_DAYS days, by push
 *     (works today) AND by WhatsApp through the generic order-update template
 *     ("Hola {{1}}, {{2}}") — which activates by itself once the Meta setup
 *     lands, no new template needed.
 */
@Injectable()
export class BirthdayCron {
  private readonly logger = new Logger(BirthdayCron.name);
  private readonly whatsappTemplate: string | null;

  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly push: PushService,
    private readonly settings: AppSettingsService,
    private readonly whatsapp: WhatsAppService,
    config: ConfigService,
  ) {
    this.whatsappTemplate =
      config.get<string>('WHATSAPP_ORDER_TEMPLATE_NAME') ?? null;
  }

  @Cron('0 9 * * *', { timeZone: 'America/New_York' })
  async run(): Promise<void> {
    await this.runDaily();
    await this.runHeadsUp();
  }

  async runDaily(): Promise<{ birthdays: number; sent: number }> {
    const rows: Array<{ id: string; full_name: string | null }> =
      await this.users.query(
        `
        SELECT id, full_name
        FROM users
        WHERE role = 'client'
          AND date_of_birth IS NOT NULL
          AND (
            (
              EXTRACT(MONTH FROM date_of_birth) = EXTRACT(MONTH FROM (now() AT TIME ZONE 'America/New_York'))
              AND EXTRACT(DAY FROM date_of_birth) = EXTRACT(DAY FROM (now() AT TIME ZONE 'America/New_York'))
            )
            OR (
              -- Feb 29 birthday on a non-leap Feb 28
              EXTRACT(MONTH FROM date_of_birth) = 2 AND EXTRACT(DAY FROM date_of_birth) = 29
              AND EXTRACT(MONTH FROM (now() AT TIME ZONE 'America/New_York')) = 2
              AND EXTRACT(DAY FROM (now() AT TIME ZONE 'America/New_York')) = 28
              AND NOT (
                (EXTRACT(YEAR FROM (now() AT TIME ZONE 'America/New_York'))::int % 4 = 0
                 AND EXTRACT(YEAR FROM (now() AT TIME ZONE 'America/New_York'))::int % 100 <> 0)
                OR EXTRACT(YEAR FROM (now() AT TIME ZONE 'America/New_York'))::int % 400 = 0
              )
            )
          )
        `,
      );

    if (rows.length === 0) return { birthdays: 0, sent: 0 };

    const template = await this.settings.getBirthdayMessage();
    let sent = 0;
    for (const row of rows) {
      const firstName =
        (row.full_name ?? '').trim().split(/\s+/)[0] || 'crack';
      const title = template.title.replaceAll('{nombre}', firstName);
      const body = template.body.replaceAll('{nombre}', firstName);
      try {
        const accepted = await this.push.sendToUser(row.id, title, body);
        if (accepted > 0) sent += 1;
      } catch (err) {
        this.logger.error(
          `BirthdayCron: push failed for user ${row.id}: ${(err as Error).message}`,
        );
      }
    }

    this.logger.log(
      `BirthdayCron: ${rows.length} birthday(s) today, ${sent} greeted by push`,
    );
    return { birthdays: rows.length, sent };
  }

  /**
   * Gift lead time: tell every super admin which clients have their birthday
   * in HEADS_UP_DAYS days. One combined message per admin (never one ping per
   * birthday). Best-effort on both channels; failures only log.
   */
  async runHeadsUp(): Promise<{ upcoming: number; adminsNotified: number }> {
    const upcoming: Array<{
      full_name: string | null;
      phone: string | null;
      birthday_label: string;
    }> = await this.users.query(
      `
      SELECT full_name, phone,
             to_char(date_of_birth, 'DD/MM') AS birthday_label
      FROM users
      WHERE role = 'client'
        AND date_of_birth IS NOT NULL
        AND EXTRACT(MONTH FROM date_of_birth) =
            EXTRACT(MONTH FROM ((now() AT TIME ZONE 'America/New_York') + interval '${HEADS_UP_DAYS} days'))
        AND EXTRACT(DAY FROM date_of_birth) =
            EXTRACT(DAY FROM ((now() AT TIME ZONE 'America/New_York') + interval '${HEADS_UP_DAYS} days'))
      ORDER BY full_name ASC
      `,
    );
    if (upcoming.length === 0) return { upcoming: 0, adminsNotified: 0 };

    const list = upcoming
      .map((c) => {
        const name = (c.full_name ?? '').trim() || 'Cliente sin nombre';
        return c.phone ? `${name} (${c.phone})` : name;
      })
      .join(', ');
    const detail =
      `en ${HEADS_UP_DAYS} días (${upcoming[0].birthday_label}) ` +
      `cumple${upcoming.length === 1 ? '' : 'n'} años: ${list}. ` +
      'Ve preparando el regalo 🎁';

    const admins: Array<{ id: string; full_name: string | null; phone: string | null }> =
      await this.users.query(
        `SELECT id, full_name, phone FROM users WHERE role = 'super_admin_delivery'`,
      );

    let adminsNotified = 0;
    for (const admin of admins) {
      let reached = false;
      try {
        const accepted = await this.push.sendToUser(
          admin.id,
          'Cumpleaños en camino 🎁',
          detail.charAt(0).toUpperCase() + detail.slice(1),
        );
        reached = accepted > 0;
      } catch (err) {
        this.logger.error(
          `BirthdayCron heads-up: push failed for admin ${admin.id}: ${(err as Error).message}`,
        );
      }
      if (admin.phone) {
        const adminName =
          (admin.full_name ?? '').trim().split(/\s+/)[0] || 'Hola';
        try {
          // Reuses the order-update template ("Hola {{1}}, {{2}}"). Skips
          // itself with a log line until the Meta credentials are configured.
          const delivered = await this.whatsapp.sendTemplate(
            admin.phone,
            this.whatsappTemplate,
            [adminName, detail],
          );
          reached = reached || delivered;
        } catch (err) {
          this.logger.error(
            `BirthdayCron heads-up: WhatsApp failed for admin ${admin.id}: ${(err as Error).message}`,
          );
        }
      }
      if (reached) adminsNotified += 1;
    }

    this.logger.log(
      `BirthdayCron heads-up: ${upcoming.length} birthday(s) in ${HEADS_UP_DAYS} days, ${adminsNotified}/${admins.length} admin(s) reached`,
    );
    return { upcoming: upcoming.length, adminsNotified };
  }
}
