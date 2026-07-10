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
  let push: { sendToUser: jest.Mock };

  beforeEach(async () => {
    tokensRepo = {
      query: jest.fn().mockResolvedValue([]),
      createQueryBuilder: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnThis(),
        getCount: jest.fn().mockResolvedValue(0),
      }),
    };
    push = { sendToUser: jest.fn().mockResolvedValue(1) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BroadcastService,
        { provide: getRepositoryToken(PushToken), useValue: tokensRepo },
        { provide: PushService, useValue: push },
      ],
    }).compile();
    service = module.get(BroadcastService);
  });

  it('sends the message to every user in the audience and sums accepted counts', async () => {
    tokensRepo.query.mockResolvedValue([
      { user_id: 'u1' },
      { user_id: 'u2' },
      { user_id: 'u3' },
    ]);
    push.sendToUser
      .mockResolvedValueOnce(2) // two devices
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(0); // permission revoked / dead tokens

    const result = await service.broadcast('all', 'Oferta', '2x1 hoy');

    expect(push.sendToUser).toHaveBeenCalledTimes(3);
    expect(push.sendToUser).toHaveBeenCalledWith('u1', 'Oferta', '2x1 hoy');
    expect(result).toEqual({ users: 3, accepted: 3 });
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
