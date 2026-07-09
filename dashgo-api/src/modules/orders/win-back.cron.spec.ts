import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../../entities/user.entity';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { WinBackCron } from './win-back.cron';

describe('WinBackCron', () => {
  let usersRepo: jest.Mocked<Pick<Repository<User>, 'query' | 'update'>>;
  let whatsapp: { sendTemplate: jest.Mock };

  async function build(templateName: string | undefined): Promise<WinBackCron> {
    usersRepo = {
      query: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    } as unknown as jest.Mocked<Pick<Repository<User>, 'query' | 'update'>>;
    whatsapp = { sendTemplate: jest.fn().mockResolvedValue(true) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WinBackCron,
        { provide: getRepositoryToken(User), useValue: usersRepo },
        { provide: WhatsAppService, useValue: whatsapp },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) =>
              key === 'WHATSAPP_WINBACK_TEMPLATE_NAME' ? templateName : undefined,
            ),
          },
        },
      ],
    }).compile();

    return module.get(WinBackCron);
  }

  const lapsedRow = {
    id: 'user-1',
    phone: '+12015550123',
    full_name: 'María Pérez',
    last_order: new Date('2026-06-01T00:00:00Z'),
  };

  it('skips entirely (no query, no sends) when the template is not configured', async () => {
    const cron = await build(undefined);
    const result = await cron.runDaily();
    expect(result).toEqual({ candidates: 0, sent: 0 });
    expect(usersRepo.query).not.toHaveBeenCalled();
    expect(whatsapp.sendTemplate).not.toHaveBeenCalled();
  });

  it('sends the reminder with the first name and stamps lastOrderReminderAt', async () => {
    const cron = await build('winback_es');
    usersRepo.query.mockResolvedValue([lapsedRow]);

    const result = await cron.runDaily();

    expect(whatsapp.sendTemplate).toHaveBeenCalledWith(
      '+12015550123',
      'winback_es',
      ['María'],
    );
    expect(usersRepo.update).toHaveBeenCalledWith('user-1', {
      lastOrderReminderAt: expect.any(Date),
    });
    expect(result).toEqual({ candidates: 1, sent: 1 });
  });

  it('does NOT stamp the reminder when Meta skipped the send (unconfigured downstream)', async () => {
    const cron = await build('winback_es');
    usersRepo.query.mockResolvedValue([lapsedRow]);
    whatsapp.sendTemplate.mockResolvedValue(false);

    const result = await cron.runDaily();

    expect(usersRepo.update).not.toHaveBeenCalled();
    expect(result).toEqual({ candidates: 1, sent: 0 });
  });

  it('continues past a failing send and still processes the rest', async () => {
    const cron = await build('winback_es');
    usersRepo.query.mockResolvedValue([
      lapsedRow,
      { ...lapsedRow, id: 'user-2', phone: '+12015550124', full_name: 'Pedro' },
    ]);
    whatsapp.sendTemplate
      .mockRejectedValueOnce(new Error('Meta 131026'))
      .mockResolvedValueOnce(true);

    const result = await cron.runDaily();

    expect(result).toEqual({ candidates: 2, sent: 1 });
    expect(usersRepo.update).toHaveBeenCalledTimes(1);
    expect(usersRepo.update).toHaveBeenCalledWith('user-2', {
      lastOrderReminderAt: expect.any(Date),
    });
  });
});
