import 'reflect-metadata';
import { HttpStatus, INestApplication } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import { DataSource } from 'typeorm';
import { IS_PUBLIC_KEY } from '../common/decorators/public.decorator';
import { HealthController } from './health.controller';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const request = require('supertest') as typeof import('supertest');

/**
 * Builds a tiny app that mounts HealthController against a stubbed DataSource.
 * We deliberately avoid the full AppModule (and its TypeORM/Twilio/Stripe deps)
 * to keep this a true unit test that can prove the 200/503 contract in
 * isolation.
 */
async function buildApp(dataSourceStub: Partial<DataSource>): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [
      // Tight throttler limit so we can also assert /health is exempt.
      ThrottlerModule.forRoot([{ ttl: 60_000, limit: 1 }]),
    ],
    controllers: [HealthController],
    providers: [
      { provide: DataSource, useValue: dataSourceStub },
    ],
  }).compile();

  const app = moduleRef.createNestApplication();
  await app.init();
  return app;
}

describe('HealthController', () => {
  let app: INestApplication;

  afterEach(async () => {
    if (app) await app.close();
  });

  describe('contract', () => {
    it('returns 200 + status:ok when the DB probe succeeds', async () => {
      app = await buildApp({
        query: jest.fn().mockResolvedValue([{ '?column?': 1 }]),
      });

      const res = await request(app.getHttpServer()).get('/health');

      expect(res.status).toBe(HttpStatus.OK);
      expect(res.body).toMatchObject({
        status: 'ok',
        checks: { db: 'ok' },
      });
      expect(typeof res.body.uptime).toBe('number');
    });

    it('returns 503 + db:fail when the DB probe rejects', async () => {
      app = await buildApp({
        query: jest.fn().mockRejectedValue(new Error('connection refused')),
      });

      const res = await request(app.getHttpServer()).get('/health');

      expect(res.status).toBe(HttpStatus.SERVICE_UNAVAILABLE);
      expect(res.body).toMatchObject({
        status: 'degraded',
        checks: { db: 'fail' },
      });
    });

    it('returns 503 within 3s when the DB probe hangs past the 2s budget', async () => {
      app = await buildApp({
        // Simulates a hung DB: query never resolves within the probe window.
        // We resolve after 5s so the timeout path (2s) wins the race. unref so
        // the lingering timer doesn't keep Jest's event loop alive after the
        // probe race has already settled.
        query: jest.fn().mockImplementation(
          () =>
            new Promise((resolve) => {
              const t = setTimeout(resolve, 5_000);
              t.unref?.();
            }),
        ),
      });

      const started = Date.now();
      const res = await request(app.getHttpServer()).get('/health');
      const elapsed = Date.now() - started;

      expect(res.status).toBe(HttpStatus.SERVICE_UNAVAILABLE);
      expect(res.body.checks.db).toBe('fail');
      // Probe budget is 2s; allow generous headroom for slow CI but well below
      // the 5s hang we simulated.
      expect(elapsed).toBeLessThan(3_000);
    }, 10_000);
  });

  describe('exemptions', () => {
    it('responds without any Authorization header', async () => {
      app = await buildApp({
        query: jest.fn().mockResolvedValue([{ '?column?': 1 }]),
      });

      const res = await request(app.getHttpServer())
        .get('/health')
        // Explicitly send no auth header.
        .unset('Authorization');

      expect(res.status).toBe(HttpStatus.OK);
    });

    it('marks the controller as @Public so the JwtAuthGuard short-circuits', () => {
      const reflector = new Reflector();
      const isPublic = reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
        HealthController.prototype.check,
        HealthController,
      ]);
      expect(isPublic).toBe(true);
    });

    it('survives more requests than the global throttler limit allows', async () => {
      // ThrottlerModule above is configured with limit: 1 per 60s. Without the
      // @SkipThrottle decorator, the 2nd hit would be rejected with 429.
      app = await buildApp({
        query: jest.fn().mockResolvedValue([{ '?column?': 1 }]),
      });
      const server = app.getHttpServer();

      const first = await request(server).get('/health');
      const second = await request(server).get('/health');
      const third = await request(server).get('/health');

      expect(first.status).toBe(HttpStatus.OK);
      expect(second.status).toBe(HttpStatus.OK);
      expect(third.status).toBe(HttpStatus.OK);
    });
  });
});
