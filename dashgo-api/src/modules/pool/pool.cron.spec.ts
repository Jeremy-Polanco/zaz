/**
 * PoolCron — reparto trimestral del pool de asociados.
 *
 * Es la única pieza que implementa la "recuperación al arrancar": si la app
 * estuvo caída el día del corte, el boot o el siguiente tick diario reparte los
 * trimestres atrasados. En test el corrido de arranque no se programa (los
 * specs de integración comparten base y no pueden sufrir un reparto ajeno).
 */
import { Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PoolCron } from './pool.cron';
import { PoolService } from './pool.service';

describe('PoolCron', () => {
  let cron: PoolCron;
  let pool: { distributeDueQuarters: jest.Mock };
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(async () => {
    pool = { distributeDueQuarters: jest.fn().mockResolvedValue([]) };
    const module: TestingModule = await Test.createTestingModule({
      providers: [PoolCron, { provide: PoolService, useValue: pool }],
    }).compile();
    cron = module.get(PoolCron);
  });

  afterEach(() => {
    cron.onModuleDestroy();
    jest.useRealTimers();
    jest.restoreAllMocks();
    process.env.NODE_ENV = originalNodeEnv;
  });

  it('la corrida diaria delega en distributeDueQuarters', async () => {
    await cron.runDaily();
    expect(pool.distributeDueQuarters).toHaveBeenCalledTimes(1);
  });

  it('fuera de test, al arrancar programa una corrida a los 20 s y no antes', () => {
    process.env.NODE_ENV = 'production';
    jest.useFakeTimers();

    cron.onApplicationBootstrap();
    expect(pool.distributeDueQuarters).not.toHaveBeenCalled();

    jest.advanceTimersByTime(19_999);
    expect(pool.distributeDueQuarters).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1);
    expect(pool.distributeDueQuarters).toHaveBeenCalledTimes(1);
  });

  it('con NODE_ENV=test no programa nada al arrancar', () => {
    process.env.NODE_ENV = 'test';
    jest.useFakeTimers();

    cron.onApplicationBootstrap();
    jest.advanceTimersByTime(60_000);

    expect(pool.distributeDueQuarters).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  });

  it('un error en el reparto se loguea y no se propaga', async () => {
    const logError = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    pool.distributeDueQuarters.mockRejectedValueOnce(new Error('db caída'));

    await expect(cron.runDaily()).resolves.toBeUndefined();
    expect(logError).toHaveBeenCalledWith(expect.stringContaining('db caída'));
  });

  it('onModuleDestroy cancela el corrido de arranque pendiente', () => {
    process.env.NODE_ENV = 'production';
    jest.useFakeTimers();

    cron.onApplicationBootstrap();
    cron.onModuleDestroy();
    jest.advanceTimersByTime(60_000);

    expect(pool.distributeDueQuarters).not.toHaveBeenCalled();
  });
});
