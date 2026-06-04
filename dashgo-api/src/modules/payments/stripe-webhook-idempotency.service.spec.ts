import { BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  MAX_WEBHOOK_RETRIES,
  StripeWebhookEvent,
} from '../../entities/stripe-webhook-event.entity';
import {
  StripeEventLike,
  StripeWebhookIdempotencyService,
} from './stripe-webhook-idempotency.service';

/**
 * Specs for StripeWebhookIdempotencyService.
 *
 * Covers:
 *   - parseSignatureTimestamp (extract t= from Stripe-Signature header)
 *   - assertFresh on signature.t (NC2: replay window vs Stripe retry support)
 *   - assertFresh on event.created (defence-in-depth ceiling)
 *   - runOnce first delivery: inserts + processed
 *   - runOnce duplicate (processed): idempotent short-circuit
 *   - runOnce dead: short-circuit + dead outcome
 *   - runOnce concurrent: advisory lock serialises (NC3)
 *   - runOnce failed-row replay: re-runs handler, bumps retry_count (NC3)
 *   - runOnce dead-after-MAX_RETRIES (NC3)
 *   - markFailed re-throws on DB error (HIGH hardening)
 *   - deleteProcessedOlderThan filters by status='processed' (HIGH)
 *   - janitorFlipStuckPending (HIGH)
 */

function makeEvent(overrides: Partial<StripeEventLike> = {}): StripeEventLike {
  return {
    id: 'evt_test_1',
    type: 'payment_intent.succeeded',
    created: Math.floor(Date.now() / 1000),
    ...overrides,
  };
}

/**
 * Mock TypeORM repository. The decision-TX uses raw query + queryBuilder +
 * insert/update on a transactional EntityManager; the handler-TX uses
 * update on a transactional EntityManager; janitor + cleanup use top-level
 * update/delete.
 *
 * To keep the test surface small we expose a stateful "existingRow" the
 * fixture toggles per scenario, and a `txQueue` so the test can introspect
 * the order of calls to the two distinct transactions.
 */
function makeMockRepo(initial: {
  existing?: Partial<StripeWebhookEvent> | null;
} = {}) {
  let existing: Partial<StripeWebhookEvent> | null =
    initial.existing === undefined ? null : initial.existing;

  // Hooks the test can spy on.
  const advisoryLock = jest.fn().mockResolvedValue(undefined);
  const txInsert = jest.fn().mockResolvedValue({ identifiers: [{ id: 'r' }] });
  const txUpdate = jest.fn().mockResolvedValue({ affected: 1 });

  function buildTxManager() {
    return {
      query: jest.fn(async (sql: string, params: unknown[]) => {
        if (sql.includes('pg_advisory_xact_lock')) {
          return advisoryLock(sql, params);
        }
        return undefined;
      }),
      createQueryBuilder: jest.fn(() => ({
        where: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(existing),
      })),
      insert: txInsert,
      update: txUpdate,
    };
  }

  return {
    insert: jest.fn().mockResolvedValue({ identifiers: [{ id: 'row-1' }] }),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
    delete: jest.fn().mockResolvedValue({ affected: 0 }),
    manager: {
      transaction: jest.fn(
        async (
          work: (tx: ReturnType<typeof buildTxManager>) => Promise<void>,
        ) => {
          await work(buildTxManager());
        },
      ),
    },
    // Helpers the tests use to drive scenarios.
    __setExisting(row: Partial<StripeWebhookEvent> | null) {
      existing = row;
    },
    __advisoryLock: advisoryLock,
    __txInsert: txInsert,
    __txUpdate: txUpdate,
  };
}

describe('StripeWebhookIdempotencyService', () => {
  let service: StripeWebhookIdempotencyService;
  let repo: ReturnType<typeof makeMockRepo>;

  beforeEach(async () => {
    repo = makeMockRepo();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StripeWebhookIdempotencyService,
        { provide: getRepositoryToken(StripeWebhookEvent), useValue: repo },
      ],
    }).compile();

    service = module.get(StripeWebhookIdempotencyService);
  });

  // ─── parseSignatureTimestamp ────────────────────────────────────────────

  describe('parseSignatureTimestamp', () => {
    it('extracts t= from a typical Stripe-Signature header', () => {
      expect(
        service.parseSignatureTimestamp(
          't=1700000000,v1=abc123,v0=def456',
        ),
      ).toBe(1700000000);
    });

    it('tolerates whitespace between parts', () => {
      expect(
        service.parseSignatureTimestamp('t=1700000000, v1=abc123'),
      ).toBe(1700000000);
    });

    it('returns null when header is missing', () => {
      expect(service.parseSignatureTimestamp(undefined)).toBeNull();
      expect(service.parseSignatureTimestamp('')).toBeNull();
    });

    it('returns null when t= is missing', () => {
      expect(service.parseSignatureTimestamp('v1=abc,v0=def')).toBeNull();
    });

    it('returns null when t= is not a positive number', () => {
      expect(service.parseSignatureTimestamp('t=abc,v1=def')).toBeNull();
      expect(service.parseSignatureTimestamp('t=0,v1=def')).toBeNull();
      expect(service.parseSignatureTimestamp('t=-1,v1=def')).toBeNull();
    });
  });

  // ─── assertFresh ────────────────────────────────────────────────────────

  describe('assertFresh — signature freshness (NC2 replay window)', () => {
    it('accepts when signature.t = now', () => {
      const now = new Date('2026-06-01T12:00:00Z');
      const nowSec = Math.floor(now.getTime() / 1000);
      const evt = makeEvent({ created: nowSec });
      expect(() => service.assertFresh(evt, nowSec, now)).not.toThrow();
    });

    it('accepts when signature.t = 4m59s old (inside replay window)', () => {
      const now = new Date('2026-06-01T12:00:00Z');
      const nowSec = Math.floor(now.getTime() / 1000);
      const t = nowSec - (4 * 60 + 59);
      expect(() =>
        service.assertFresh(makeEvent({ created: nowSec }), t, now),
      ).not.toThrow();
    });

    it('REJECTS when signature.t = 6m old (replay)', () => {
      const now = new Date('2026-06-01T12:00:00Z');
      const nowSec = Math.floor(now.getTime() / 1000);
      const t = nowSec - 6 * 60;
      expect(() =>
        service.assertFresh(makeEvent({ created: nowSec }), t, now),
      ).toThrow(BadRequestException);
    });

    it('REJECTS when signature is missing (cannot verify freshness)', () => {
      const now = new Date('2026-06-01T12:00:00Z');
      const nowSec = Math.floor(now.getTime() / 1000);
      expect(() =>
        service.assertFresh(makeEvent({ created: nowSec }), null, now),
      ).toThrow(BadRequestException);
    });

    it('REJECTS when signature.t is 2m in the future (skew)', () => {
      const now = new Date('2026-06-01T12:00:00Z');
      const nowSec = Math.floor(now.getTime() / 1000);
      const t = nowSec + 2 * 60;
      expect(() =>
        service.assertFresh(makeEvent({ created: nowSec }), t, now),
      ).toThrow(BadRequestException);
    });

    it('accepts signature 30s in the future (within skew)', () => {
      const now = new Date('2026-06-01T12:00:00Z');
      const nowSec = Math.floor(now.getTime() / 1000);
      const t = nowSec + 30;
      expect(() =>
        service.assertFresh(makeEvent({ created: nowSec }), t, now),
      ).not.toThrow();
    });
  });

  describe('assertFresh — event.created defence in depth (NC2)', () => {
    it('NC2 KEY: accepts a 1-hour-old Stripe retry (sig.t=now, created=1h old)', () => {
      // This is the heart of NC2. Stripe retries failed deliveries with
      // exponential backoff; the retry has a FRESH `Stripe-Signature`
      // (t=now) but the SAME `event.created` (1h old on the first retry,
      // could be 2 days old by the last). The previous implementation
      // clamped on event.created and silently rejected every retry.
      const now = new Date('2026-06-01T12:00:00Z');
      const nowSec = Math.floor(now.getTime() / 1000);
      const event = makeEvent({ created: nowSec - 60 * 60 }); // 1h old
      const sigT = nowSec; // fresh signature

      expect(() => service.assertFresh(event, sigT, now)).not.toThrow();
    });

    it('accepts a near-3-day-old Stripe retry (top of Stripe retry window)', () => {
      const now = new Date('2026-06-01T12:00:00Z');
      const nowSec = Math.floor(now.getTime() / 1000);
      const event = makeEvent({ created: nowSec - 2 * 24 * 60 * 60 - 12 * 60 * 60 });
      expect(() =>
        service.assertFresh(event, nowSec, now),
      ).not.toThrow();
    });

    it('REJECTS event.created older than 3-day ceiling (pathological)', () => {
      const now = new Date('2026-06-01T12:00:00Z');
      const nowSec = Math.floor(now.getTime() / 1000);
      const event = makeEvent({ created: nowSec - 30 * 24 * 60 * 60 });
      expect(() => service.assertFresh(event, nowSec, now)).toThrow(
        BadRequestException,
      );
    });

    it('REJECTS event.created far in the future (forged)', () => {
      const now = new Date('2026-06-01T12:00:00Z');
      const nowSec = Math.floor(now.getTime() / 1000);
      const event = makeEvent({ created: nowSec + 60 * 60 });
      expect(() => service.assertFresh(event, nowSec, now)).toThrow(
        BadRequestException,
      );
    });
  });

  // ─── runOnce ────────────────────────────────────────────────────────────

  describe('runOnce — first delivery (no existing row)', () => {
    it('takes advisory lock, INSERTs pending row with retry_count=1, runs handler in handler-TX, marks processed', async () => {
      const handler = jest.fn().mockResolvedValue(undefined);
      const event = makeEvent({ id: 'evt_first' });

      const outcome = await service.runOnce(event, handler);

      expect(outcome).toEqual({ status: 'processed' });

      // Advisory lock invoked with the event-keyed string parameter
      expect(repo.__advisoryLock).toHaveBeenCalled();
      const advisoryArgs = repo.__advisoryLock.mock.calls[0] as [string, unknown[]];
      expect(advisoryArgs[1]).toEqual(['stripe_evt:evt_first']);

      // Decision TX inserted a pending row with retry_count=1
      expect(repo.__txInsert).toHaveBeenCalledWith(
        StripeWebhookEvent,
        expect.objectContaining({
          stripeEventId: 'evt_first',
          eventType: 'payment_intent.succeeded',
          status: 'pending',
          retryCount: 1,
        }),
      );

      // Handler ran
      expect(handler).toHaveBeenCalledTimes(1);

      // Handler-TX update marked processed
      const updateCalls = repo.__txUpdate.mock.calls as Array<
        [unknown, { stripeEventId: string }, Record<string, unknown>]
      >;
      const processedUpdate = updateCalls.find(
        ([, criteria]) => criteria.stripeEventId === 'evt_first',
      );
      expect(processedUpdate).toBeDefined();
      if (processedUpdate) {
        expect(processedUpdate[2]).toMatchObject({
          status: 'processed',
          error: null,
        });
        expect(processedUpdate[2].processedAt).toBeInstanceOf(Date);
      }
    });
  });

  describe('runOnce — existing row status=processed (duplicate)', () => {
    it('short-circuits to duplicate without running handler or marking anything', async () => {
      const handler = jest.fn();
      repo.__setExisting({
        stripeEventId: 'evt_dup',
        status: 'processed',
        retryCount: 1,
      });

      const outcome = await service.runOnce(makeEvent({ id: 'evt_dup' }), handler);

      expect(outcome).toEqual({ status: 'duplicate' });
      expect(handler).not.toHaveBeenCalled();
      // Only the decision TX ran (no handler-TX)
      expect(repo.manager.transaction).toHaveBeenCalledTimes(1);
    });
  });

  describe('runOnce — existing row status=dead', () => {
    it('returns dead WITHOUT running handler so controller can 500 Stripe', async () => {
      const handler = jest.fn();
      repo.__setExisting({
        stripeEventId: 'evt_dead',
        status: 'dead',
        retryCount: MAX_WEBHOOK_RETRIES,
        error: 'order not found',
      });

      const outcome = await service.runOnce(
        makeEvent({ id: 'evt_dead' }),
        handler,
      );

      expect(outcome.status).toBe('dead');
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('runOnce — existing row status=failed (NC3 replay)', () => {
    it('re-runs the handler, bumps retry_count, marks processed on success', async () => {
      const handler = jest.fn().mockResolvedValue(undefined);
      repo.__setExisting({
        stripeEventId: 'evt_was_failed',
        status: 'failed',
        retryCount: 2,
        error: 'previous attempt: timeout',
      });

      const outcome = await service.runOnce(
        makeEvent({ id: 'evt_was_failed' }),
        handler,
      );

      expect(outcome).toEqual({ status: 'processed' });
      expect(handler).toHaveBeenCalledTimes(1);

      // Decision TX bumped retry_count and reset status to pending
      const bumpUpdate = repo.__txUpdate.mock.calls.find((call) => {
        const [, , patch] = call as [unknown, unknown, Record<string, unknown>];
        return patch.status === 'pending' && patch.retryCount === 3;
      });
      expect(bumpUpdate).toBeDefined();
    });
  });

  describe('runOnce — existing row status=pending (resumable)', () => {
    it('re-runs the handler when pending row is seen on retry', async () => {
      const handler = jest.fn().mockResolvedValue(undefined);
      repo.__setExisting({
        stripeEventId: 'evt_pending',
        status: 'pending',
        retryCount: 1,
      });

      const outcome = await service.runOnce(
        makeEvent({ id: 'evt_pending' }),
        handler,
      );

      expect(outcome).toEqual({ status: 'processed' });
      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  describe('runOnce — retry-count cap (NC3 dead)', () => {
    it('flips to dead and skips handler when next retry would exceed MAX_WEBHOOK_RETRIES', async () => {
      const handler = jest.fn();
      repo.__setExisting({
        stripeEventId: 'evt_about_to_die',
        status: 'failed',
        retryCount: MAX_WEBHOOK_RETRIES, // next would be MAX+1
      });

      const outcome = await service.runOnce(
        makeEvent({ id: 'evt_about_to_die' }),
        handler,
      );

      expect(outcome.status).toBe('dead');
      expect(handler).not.toHaveBeenCalled();

      // Decision TX flipped status to dead
      const deadUpdate = repo.__txUpdate.mock.calls.find((call) => {
        const [, , patch] = call as [unknown, unknown, Record<string, unknown>];
        return patch.status === 'dead';
      });
      expect(deadUpdate).toBeDefined();
    });
  });

  describe('runOnce — handler failure on a fresh attempt', () => {
    it('marks the row failed (with new error) and returns {status:failed} so Stripe retries', async () => {
      const handler = jest.fn().mockRejectedValue(new Error('order not found'));
      const event = makeEvent({ id: 'evt_failed' });

      const outcome = await service.runOnce(event, handler);

      expect(outcome.status).toBe('failed');
      // Failure written OUTSIDE the rolled-back TX
      expect(repo.update).toHaveBeenCalledWith(
        { stripeEventId: 'evt_failed' },
        expect.objectContaining({
          status: 'failed',
          error: 'order not found',
        }),
      );
    });

    it('truncates very long error messages', async () => {
      const handler = jest.fn().mockRejectedValue(new Error('X'.repeat(5000)));
      await service.runOnce(makeEvent({ id: 'evt_long' }), handler);

      const failureCall = repo.update.mock.calls.find((call) => {
        const [criteria] = call as [{ stripeEventId: string }, unknown];
        return criteria.stripeEventId === 'evt_long';
      }) as undefined | [{ stripeEventId: string }, { error: string }];
      expect(failureCall).toBeDefined();
      if (failureCall) {
        expect(failureCall[1].error.length).toBeLessThanOrEqual(2000);
      }
    });
  });

  describe('runOnce — markFailed must NOT swallow DB errors (HIGH)', () => {
    it('re-throws InternalServerErrorException when the failure-recording write itself fails', async () => {
      const handler = jest.fn().mockRejectedValue(new Error('biz error'));
      repo.update.mockRejectedValueOnce(new Error('DB outage'));

      await expect(
        service.runOnce(makeEvent({ id: 'evt_db_down' }), handler),
      ).rejects.toBeInstanceOf(InternalServerErrorException);
    });
  });

  // ─── deleteProcessedOlderThan ───────────────────────────────────────────

  describe('deleteProcessedOlderThan (HIGH retention filter)', () => {
    it('only purges rows where status=processed AND processed_at < cutoff', async () => {
      repo.delete.mockResolvedValueOnce({ affected: 7 });
      const cutoff = new Date('2026-05-01T00:00:00Z');

      const deleted = await service.deleteProcessedOlderThan(cutoff);

      expect(deleted).toBe(7);
      const [criteria] = repo.delete.mock.calls[0] as [Record<string, unknown>];
      expect(criteria.status).toBe('processed');
      expect(criteria).toHaveProperty('processedAt');
    });

    it('keeps failed/pending/dead rows past the cutoff (forensic trail)', async () => {
      // The criteria object must constrain status='processed'; that's what
      // protects the other statuses. Verified above. Sanity: no broader
      // criteria slipped in.
      repo.delete.mockResolvedValueOnce({ affected: 0 });
      await service.deleteProcessedOlderThan(new Date());

      const [criteria] = repo.delete.mock.calls[0] as [Record<string, unknown>];
      // status MUST equal processed (not undefined / not LessThan).
      expect(criteria.status).toBe('processed');
    });

    it('returns 0 when no rows are affected', async () => {
      repo.delete.mockResolvedValueOnce({ affected: undefined });
      expect(await service.deleteProcessedOlderThan(new Date())).toBe(0);
    });
  });

  // ─── janitorFlipStuckPending ────────────────────────────────────────────

  describe('janitorFlipStuckPending (HIGH janitor)', () => {
    it('flips pending rows older than 10 minutes with retry_count=0 to failed', async () => {
      repo.update.mockResolvedValueOnce({ affected: 3 });
      const now = new Date('2026-06-01T12:00:00Z');

      const flipped = await service.janitorFlipStuckPending(now);

      expect(flipped).toBe(3);
      const [criteria, patch] = repo.update.mock.calls[0] as [
        Record<string, unknown>,
        Record<string, unknown>,
      ];
      expect(criteria.status).toBe('pending');
      expect(criteria.retryCount).toBe(0);
      expect(criteria).toHaveProperty('receivedAt');
      expect(patch.status).toBe('failed');
      expect(patch.error).toMatch(/janitor/);
    });
  });
});
