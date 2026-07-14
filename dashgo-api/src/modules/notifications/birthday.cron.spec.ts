import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { User } from '../../entities/user.entity';
import { PushService } from './push.service';
import { AppSettingsService } from './app-settings.service';
import { BirthdayCron } from './birthday.cron';

describe('BirthdayCron', () => {
  let cron: BirthdayCron;
  let usersRepo: { query: jest.Mock };
  let push: { sendToUser: jest.Mock };
  let settings: { getBirthdayMessage: jest.Mock };

  beforeEach(async () => {
    usersRepo = { query: jest.fn().mockResolvedValue([]) };
    push = { sendToUser: jest.fn().mockResolvedValue(1) };
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
});
