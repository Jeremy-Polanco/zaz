import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import { User } from '../../entities/user.entity';
import { PushService } from './push.service';
import { AppSettingsService } from './app-settings.service';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { BirthdayCron } from './birthday.cron';

describe('BirthdayCron', () => {
  let cron: BirthdayCron;
  let usersRepo: { query: jest.Mock };
  let push: { sendToUser: jest.Mock };
  let settings: { getBirthdayMessage: jest.Mock };
  let whatsapp: { sendTemplate: jest.Mock };

  beforeEach(async () => {
    usersRepo = { query: jest.fn().mockResolvedValue([]) };
    push = { sendToUser: jest.fn().mockResolvedValue(1) };
    whatsapp = { sendTemplate: jest.fn().mockResolvedValue(true) };
    settings = {
      getBirthdayMessage: jest.fn().mockResolvedValue({
        title: '¡Feliz cumpleaños, {nombre}! 🎂',
        body: 'Que tengas un gran día, {nombre} 🎉',
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BirthdayCron,
        { provide: getRepositoryToken(User), useValue: usersRepo },
        { provide: PushService, useValue: push },
        { provide: AppSettingsService, useValue: settings },
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
    cron = module.get(BirthdayCron);
  });

  it('does nothing (not even reading settings) when nobody has a birthday', async () => {
    const result = await cron.runDaily();
    expect(result).toEqual({ birthdays: 0, sent: 0 });
    expect(settings.getBirthdayMessage).not.toHaveBeenCalled();
    expect(push.sendToUser).not.toHaveBeenCalled();
  });

  it('greets each birthday user with {nombre} replaced by the first name', async () => {
    usersRepo.query.mockResolvedValue([
      { id: 'u1', full_name: 'María Pérez' },
      { id: 'u2', full_name: null },
    ]);

    const result = await cron.runDaily();

    expect(push.sendToUser).toHaveBeenNthCalledWith(
      1,
      'u1',
      '¡Feliz cumpleaños, María! 🎂',
      'Que tengas un gran día, María 🎉',
    );
    // Null name falls back without breaking the template
    const [, title2] = push.sendToUser.mock.calls[1] as [string, string];
    expect(title2).not.toContain('{nombre}');
    expect(result).toEqual({ birthdays: 2, sent: 2 });
  });

  it('counts only users whose devices accepted the push', async () => {
    usersRepo.query.mockResolvedValue([
      { id: 'u1', full_name: 'Ana' },
      { id: 'u2', full_name: 'Luis' },
    ]);
    push.sendToUser.mockResolvedValueOnce(1).mockResolvedValueOnce(0);

    const result = await cron.runDaily();
    expect(result).toEqual({ birthdays: 2, sent: 1 });
  });

  it('survives a push failure and continues with the rest', async () => {
    usersRepo.query.mockResolvedValue([
      { id: 'u1', full_name: 'Ana' },
      { id: 'u2', full_name: 'Luis' },
    ]);
    push.sendToUser
      .mockRejectedValueOnce(new Error('expo down'))
      .mockResolvedValueOnce(2);

    const result = await cron.runDaily();
    expect(result).toEqual({ birthdays: 2, sent: 1 });
  });

  describe('runHeadsUp (admin gift lead time, 3 days ahead)', () => {
    const upcomingRow = {
      full_name: 'María Pérez',
      phone: '+12015550123',
      birthday_label: '23/07',
    };
    const adminRow = {
      id: 'admin-1',
      full_name: 'Jeremy Polanco',
      phone: '+18293880711',
    };

    it('does nothing when nobody has a birthday in 3 days', async () => {
      const result = await cron.runHeadsUp();
      expect(result).toEqual({ upcoming: 0, adminsNotified: 0 });
      expect(push.sendToUser).not.toHaveBeenCalled();
      expect(whatsapp.sendTemplate).not.toHaveBeenCalled();
    });

    it('sends ONE combined push + WhatsApp per admin listing the upcoming birthdays', async () => {
      usersRepo.query
        .mockResolvedValueOnce([
          upcomingRow,
          { full_name: 'Pedro Gómez', phone: null, birthday_label: '23/07' },
        ])
        .mockResolvedValueOnce([adminRow]);

      const result = await cron.runHeadsUp();

      expect(push.sendToUser).toHaveBeenCalledTimes(1);
      const [adminId, , pushBody] = push.sendToUser.mock.calls[0] as [
        string,
        string,
        string,
      ];
      expect(adminId).toBe('admin-1');
      expect(pushBody).toContain('María Pérez (+12015550123)');
      expect(pushBody).toContain('Pedro Gómez');
      expect(pushBody).toContain('3 días');

      expect(whatsapp.sendTemplate).toHaveBeenCalledTimes(1);
      const [phone, template, params] = whatsapp.sendTemplate.mock.calls[0] as [
        string,
        string,
        string[],
      ];
      expect(phone).toBe('+18293880711');
      expect(template).toBe('order_update_es');
      expect(params[0]).toBe('Jeremy');
      expect(params[1]).toContain('María Pérez');

      expect(result).toEqual({ upcoming: 2, adminsNotified: 1 });
    });

    it('counts the admin as reached when WhatsApp lands even if push has no devices', async () => {
      usersRepo.query
        .mockResolvedValueOnce([upcomingRow])
        .mockResolvedValueOnce([adminRow]);
      push.sendToUser.mockResolvedValue(0);
      whatsapp.sendTemplate.mockResolvedValue(true);

      const result = await cron.runHeadsUp();
      expect(result).toEqual({ upcoming: 1, adminsNotified: 1 });
    });

    it('survives channel failures and still reports honestly', async () => {
      usersRepo.query
        .mockResolvedValueOnce([upcomingRow])
        .mockResolvedValueOnce([adminRow, { ...adminRow, id: 'admin-2', phone: null }]);
      push.sendToUser.mockRejectedValue(new Error('expo down'));
      whatsapp.sendTemplate.mockResolvedValue(false);

      const result = await cron.runHeadsUp();
      expect(result).toEqual({ upcoming: 1, adminsNotified: 0 });
    });
  });
});
