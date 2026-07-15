import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { PushToken } from '../../entities/push-token.entity';
import { PushService } from './push.service';
import { BroadcastService } from './broadcast.service';

describe('BroadcastService', () => {
  let service: BroadcastService;
  let tokensRepo: {
    query: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let push: { sendToUserTracked: jest.Mock; checkReceipts: jest.Mock };

  beforeEach(async () => {
    tokensRepo = {
      query: jest.fn().mockResolvedValue([]),
      createQueryBuilder: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnThis(),
        getCount: jest.fn().mockResolvedValue(0),
      }),
    };
    push = {
      sendToUserTracked: jest
        .fn()
        .mockResolvedValue({ accepted: 1, tickets: [] }),
      checkReceipts: jest
        .fn()
        .mockResolvedValue({ delivered: 0, failed: 0, pending: 0, errors: [] }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BroadcastService,
        { provide: getRepositoryToken(PushToken), useValue: tokensRepo },
        { provide: PushService, useValue: push },
      ],
    }).compile();
    service = module.get(BroadcastService);
    // Skip the real-world receipt settling delay in tests.
    (service as unknown as { receiptDelayMs: number }).receiptDelayMs = 0;
  });

  it('sends to every user, sums accepted counts and reports receipt verdicts', async () => {
    tokensRepo.query.mockResolvedValue([
      { user_id: 'u1' },
      { user_id: 'u2' },
      { user_id: 'u3' },
    ]);
    push.sendToUserTracked
      .mockResolvedValueOnce({
        accepted: 2, // two devices
        tickets: [
          { id: 't-1', token: 'tok-1' },
          { id: 't-2', token: 'tok-2' },
        ],
      })
      .mockResolvedValueOnce({
        accepted: 1,
        tickets: [{ id: 't-3', token: 'tok-3' }],
      })
      .mockResolvedValueOnce({ accepted: 0, tickets: [] }); // dead tokens
    push.checkReceipts.mockResolvedValue({
      delivered: 2,
      failed: 1,
      pending: 0,
      errors: ['InvalidCredentials'],
    });

    const result = await service.broadcast('all', 'Oferta', '2x1 hoy');

    expect(push.sendToUserTracked).toHaveBeenCalledTimes(3);
    expect(push.sendToUserTracked).toHaveBeenCalledWith('u1', 'Oferta', '2x1 hoy');
    expect(push.checkReceipts).toHaveBeenCalledWith([
      { id: 't-1', token: 'tok-1' },
      { id: 't-2', token: 'tok-2' },
      { id: 't-3', token: 'tok-3' },
    ]);
    expect(result).toEqual({
      users: 3,
      accepted: 3,
      delivered: 2,
      failed: 1,
      pending: 0,
      errors: ['InvalidCredentials'],
    });
  });

  it('skips the receipt check entirely when no ticket was accepted', async () => {
    tokensRepo.query.mockResolvedValue([{ user_id: 'u1' }]);
    push.sendToUserTracked.mockResolvedValue({ accepted: 0, tickets: [] });

    const result = await service.broadcast('all', 'Oferta', '2x1 hoy');

    expect(push.checkReceipts).not.toHaveBeenCalled();
    expect(result).toEqual({
      users: 1,
      accepted: 0,
      delivered: 0,
      failed: 0,
      pending: 0,
      errors: [],
    });
  });

  it('uses the lapsed-audience SQL (8-day HAVING) for audience=lapsed', async () => {
    tokensRepo.query.mockResolvedValue([]);
    await service.broadcast('lapsed', 'Volvé', 'Te extrañamos');
    const sql = (tokensRepo.query.mock.calls[0] as [string])[0];
    expect(sql).toContain('MAX(o.created_at) <=');
    expect(sql).toContain("o.status != 'cancelled'");
  });

  it('preview returns zeros for an empty audience without querying devices', async () => {
    tokensRepo.query.mockResolvedValue([]);
    const result = await service.preview('all');
    expect(result).toEqual({ users: 0, devices: 0 });
    expect(tokensRepo.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('preview counts distinct users and their devices', async () => {
    tokensRepo.query.mockResolvedValue([{ user_id: 'u1' }, { user_id: 'u2' }]);
    tokensRepo.createQueryBuilder.mockReturnValue({
      where: jest.fn().mockReturnThis(),
      getCount: jest.fn().mockResolvedValue(5),
    });
    const result = await service.preview('active');
    expect(result).toEqual({ users: 2, devices: 5 });
  });
});
