import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { PushToken } from '../../entities/push-token.entity';
import { PushService } from './push.service';

describe('PushService', () => {
  let service: PushService;
  let tokensRepo: {
    find: jest.Mock;
    delete: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let fetchMock: jest.SpyInstance;

  function mockExpoResponse(tickets: unknown[]) {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ data: tickets }),
    } as unknown as Response);
  }

  beforeEach(async () => {
    tokensRepo = {
      find: jest.fn().mockResolvedValue([]),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
      createQueryBuilder: jest.fn(),
    };
    fetchMock = jest.spyOn(global, 'fetch' as never);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PushService,
        { provide: getRepositoryToken(PushToken), useValue: tokensRepo },
      ],
    }).compile();
    service = module.get(PushService);
  });

  afterEach(() => fetchMock.mockRestore());

  it('returns 0 and never calls Expo when the user has no devices', async () => {
    const accepted = await service.sendToUser('u1', 'Hola', 'cuerpo');
    expect(accepted).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends to every device and counts accepted tickets', async () => {
    tokensRepo.find.mockResolvedValue([
      { token: 'ExponentPushToken[aaa]' },
      { token: 'ExponentPushToken[bbb]' },
    ]);
    mockExpoResponse([{ status: 'ok' }, { status: 'ok' }]);

    const accepted = await service.sendToUser('u1', 'Hola', 'cuerpo', {
      orderId: 'o1',
    });

    expect(accepted).toBe(2);
    const body = JSON.parse(
      (fetchMock.mock.calls[0][1] as { body: string }).body,
    ) as Array<{ to: string; data?: unknown }>;
    expect(body.map((m) => m.to)).toEqual([
      'ExponentPushToken[aaa]',
      'ExponentPushToken[bbb]',
    ]);
    expect(body[0].data).toEqual({ orderId: 'o1' });
  });

  it('prunes tokens Expo reports as DeviceNotRegistered', async () => {
    tokensRepo.find.mockResolvedValue([
      { token: 'ExponentPushToken[dead]' },
      { token: 'ExponentPushToken[live]' },
    ]);
    mockExpoResponse([
      { status: 'error', details: { error: 'DeviceNotRegistered' } },
      { status: 'ok' },
    ]);

    const accepted = await service.sendToUser('u1', 'Hola', 'cuerpo');

    expect(accepted).toBe(1);
    expect(tokensRepo.delete).toHaveBeenCalledWith({
      token: 'ExponentPushToken[dead]',
    });
  });

  it('never rejects on network failure', async () => {
    tokensRepo.find.mockResolvedValue([{ token: 'ExponentPushToken[aaa]' }]);
    fetchMock.mockRejectedValue(new Error('ECONNRESET'));
    await expect(service.sendToUser('u1', 'Hola', 'cuerpo')).resolves.toBe(0);
  });

  it('sendToUserTracked returns the ticket id + token of each accepted message', async () => {
    tokensRepo.find.mockResolvedValue([
      { token: 'ExponentPushToken[aaa]' },
      { token: 'ExponentPushToken[bbb]' },
    ]);
    mockExpoResponse([
      { status: 'ok', id: 't-1' },
      { status: 'error', details: { error: 'DeviceNotRegistered' } },
    ]);

    const result = await service.sendToUserTracked('u1', 'Hola', 'cuerpo');

    expect(result.accepted).toBe(1);
    expect(result.tickets).toEqual([
      { id: 't-1', token: 'ExponentPushToken[aaa]' },
    ]);
  });

  describe('checkReceipts', () => {
    function mockReceiptsResponse(receipts: Record<string, unknown>) {
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ data: receipts }),
      } as unknown as Response);
    }

    it('counts delivered, failed and pending receipts and collects error codes', async () => {
      mockReceiptsResponse({
        't-ok': { status: 'ok' },
        't-bad': { status: 'error', details: { error: 'InvalidCredentials' } },
        // t-later intentionally absent → still pending on Expo's side
      });

      const summary = await service.checkReceipts([
        { id: 't-ok', token: 'ExponentPushToken[aaa]' },
        { id: 't-bad', token: 'ExponentPushToken[bbb]' },
        { id: 't-later', token: 'ExponentPushToken[ccc]' },
      ]);

      expect(summary).toEqual({
        delivered: 1,
        failed: 1,
        pending: 1,
        errors: ['InvalidCredentials'],
      });
    });

    it('prunes tokens whose receipt reports DeviceNotRegistered', async () => {
      mockReceiptsResponse({
        't-dead': { status: 'error', details: { error: 'DeviceNotRegistered' } },
      });

      await service.checkReceipts([
        { id: 't-dead', token: 'ExponentPushToken[dead]' },
      ]);

      expect(tokensRepo.delete).toHaveBeenCalledWith({
        token: 'ExponentPushToken[dead]',
      });
    });

    it('treats every ticket as pending when the receipts request fails', async () => {
      fetchMock.mockRejectedValue(new Error('ECONNRESET'));

      const summary = await service.checkReceipts([
        { id: 't-1', token: 'ExponentPushToken[aaa]' },
        { id: 't-2', token: 'ExponentPushToken[bbb]' },
      ]);

      expect(summary).toEqual({
        delivered: 0,
        failed: 0,
        pending: 2,
        errors: [],
      });
    });
  });
});
