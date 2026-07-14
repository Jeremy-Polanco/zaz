import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../../entities/user.entity';
import { PushService } from './push.service';
import { AppSettingsService } from './app-settings.service';

/**
 * Daily birthday greeting — every client whose date_of_birth month/day is
 * today (America/New_York) gets a push with the admin-configured copy
 * (Notificar panel → "Mensaje de cumpleaños"; `{nombre}` is replaced with the
 * customer's first name). Runs at 09:00 NY, before the 11:00 win-back, so the
 * greeting is the first thing they see.
 *
 * Feb 29 birthdays are greeted on Feb 28 in non-leap years — never skipped.
 */
@Injectable()
export class BirthdayCron {
  private readonly logger = new Logger(BirthdayCron.name);

  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly push: PushService,
    private readonly settings: AppSettingsService,
  ) {}

  @Cron('0 9 * * *', { timeZone: 'America/New_York' })
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
}
