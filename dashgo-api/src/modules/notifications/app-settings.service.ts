import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppSetting } from '../../entities/app-setting.entity';

export const SETTING_BIRTHDAY_TITLE = 'birthday_push_title';
export const SETTING_BIRTHDAY_BODY = 'birthday_push_body';

export const BIRTHDAY_DEFAULTS = {
  title: '¡Feliz cumpleaños, {nombre}! 🎂',
  body: 'De parte de todo el equipo de Udash, ¡que tengas un gran día! 🎉',
};

/**
 * Tiny key/value settings backed by app_settings. First consumer: the
 * birthday push copy, editable from the web Notificar panel. `{nombre}` in
 * either field is replaced with the customer's first name at send time.
 */
@Injectable()
export class AppSettingsService {
  constructor(
    @InjectRepository(AppSetting)
    private readonly settings: Repository<AppSetting>,
  ) {}

  async get(key: string): Promise<string | null> {
    const row = await this.settings.findOne({ where: { key } });
    return row?.value ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    await this.settings.save(this.settings.create({ key, value }));
  }

  async getBirthdayMessage(): Promise<{ title: string; body: string }> {
    const [title, body] = await Promise.all([
      this.get(SETTING_BIRTHDAY_TITLE),
      this.get(SETTING_BIRTHDAY_BODY),
    ]);
    return {
      title: title ?? BIRTHDAY_DEFAULTS.title,
      body: body ?? BIRTHDAY_DEFAULTS.body,
    };
  }

  async setBirthdayMessage(title: string, body: string): Promise<void> {
    await this.set(SETTING_BIRTHDAY_TITLE, title);
    await this.set(SETTING_BIRTHDAY_BODY, body);
  }
}
