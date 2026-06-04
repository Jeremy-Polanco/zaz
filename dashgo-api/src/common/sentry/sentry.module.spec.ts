/**
 * Tests for SentryModule wiring.
 *
 * Two things matter:
 *   1. Init policy: Sentry.init() is called when SENTRY_DSN is set, and
 *      SKIPPED silently when it's unset (dev/test posture).
 *   2. Middleware ordering: requestHandler → tracingHandler → routes →
 *      errorHandler. This is load-bearing because Express only routes errors
 *      to a 4-arg handler if it's registered AFTER all other middleware.
 *
 * The tests deliberately do NOT exercise the real network — Sentry init is
 * mocked at the module boundary so we just verify call shape.
 */

// Mock @sentry/node BEFORE importing the module under test. jest.mock is
// hoisted, so even though the import below sits after, the mock is wired
// up first.
jest.mock('@sentry/node', () => ({
  init: jest.fn(),
  isInitialized: jest.fn(() => false),
  withIsolationScope: jest.fn((fn: () => void) => fn()),
  startSpanManual: jest.fn(
    (
      _opts: unknown,
      fn: (span: { end: () => void } | undefined) => void,
    ): void => {
      fn({ end: jest.fn() });
    },
  ),
  captureException: jest.fn(),
  setupNestErrorHandler: jest.fn(),
}));

import * as Sentry from '@sentry/node';
import type { INestApplication } from '@nestjs/common';
import {
  applySentryMiddleware,
  buildSentryMiddleware,
  initSentry,
} from './sentry.module';

const sentryMock = Sentry as unknown as {
  init: jest.Mock;
  isInitialized: jest.Mock;
  withIsolationScope: jest.Mock;
  startSpanManual: jest.Mock;
  captureException: jest.Mock;
  setupNestErrorHandler: jest.Mock;
};

describe('SentryModule', () => {
  let originalDsn: string | undefined;
  let originalNodeEnv: string | undefined;

  beforeEach(() => {
    originalDsn = process.env.SENTRY_DSN;
    originalNodeEnv = process.env.NODE_ENV;
    sentryMock.init.mockClear();
    sentryMock.isInitialized.mockClear().mockReturnValue(false);
    sentryMock.withIsolationScope.mockClear();
    sentryMock.startSpanManual.mockClear();
    sentryMock.captureException.mockClear();
    sentryMock.setupNestErrorHandler.mockClear();
  });

  afterEach(() => {
    if (originalDsn === undefined) {
      delete process.env.SENTRY_DSN;
    } else {
      process.env.SENTRY_DSN = originalDsn;
    }
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }
  });

  // -------------------------------------------------------------------------
  // initSentry() — calls Sentry.init when DSN set, skips when unset
  // -------------------------------------------------------------------------

  describe('initSentry', () => {
    it('calls Sentry.init when SENTRY_DSN is set', () => {
      process.env.SENTRY_DSN = 'https://abc@o0.ingest.sentry.io/1';
      process.env.NODE_ENV = 'production';
      const result = initSentry();
      expect(result).toBe(true);
      expect(sentryMock.init).toHaveBeenCalledTimes(1);
      expect(sentryMock.init).toHaveBeenCalledWith(
        expect.objectContaining({
          dsn: 'https://abc@o0.ingest.sentry.io/1',
          environment: 'production',
          sendDefaultPii: false,
        }),
      );
    });

    it('skips Sentry.init silently when SENTRY_DSN is unset', () => {
      delete process.env.SENTRY_DSN;
      const result = initSentry();
      expect(result).toBe(false);
      expect(sentryMock.init).not.toHaveBeenCalled();
    });

    it('is idempotent — does not re-init when already initialized', () => {
      process.env.SENTRY_DSN = 'https://abc@o0.ingest.sentry.io/1';
      sentryMock.isInitialized.mockReturnValue(true);
      const result = initSentry();
      expect(result).toBe(true);
      expect(sentryMock.init).not.toHaveBeenCalled();
    });

    it('defaults environment to development when NODE_ENV is unset', () => {
      process.env.SENTRY_DSN = 'https://abc@o0.ingest.sentry.io/1';
      delete process.env.NODE_ENV;
      initSentry();
      expect(sentryMock.init).toHaveBeenCalledWith(
        expect.objectContaining({ environment: 'development' }),
      );
    });

    it('forwards SENTRY_TRACES_SAMPLE_RATE when set', () => {
      process.env.SENTRY_DSN = 'https://abc@o0.ingest.sentry.io/1';
      process.env.SENTRY_TRACES_SAMPLE_RATE = '0.25';
      initSentry();
      expect(sentryMock.init).toHaveBeenCalledWith(
        expect.objectContaining({ tracesSampleRate: 0.25 }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // buildSentryMiddleware — returns inert handlers when DSN unset
  // -------------------------------------------------------------------------

  describe('buildSentryMiddleware', () => {
    it('returns enabled=false when SENTRY_DSN is unset', () => {
      delete process.env.SENTRY_DSN;
      const handle = buildSentryMiddleware();
      expect(handle.enabled).toBe(false);
    });

    it('returns enabled=true when SENTRY_DSN is set', () => {
      process.env.SENTRY_DSN = 'https://abc@o0.ingest.sentry.io/1';
      const handle = buildSentryMiddleware();
      expect(handle.enabled).toBe(true);
    });

    it('requestHandler passes through (calls next) when disabled', () => {
      delete process.env.SENTRY_DSN;
      const handle = buildSentryMiddleware();
      const next = jest.fn();
      handle.requestHandler({} as never, {} as never, next);
      expect(next).toHaveBeenCalledTimes(1);
      expect(sentryMock.withIsolationScope).not.toHaveBeenCalled();
    });

    it('requestHandler opens an isolation scope when enabled', () => {
      process.env.SENTRY_DSN = 'https://abc@o0.ingest.sentry.io/1';
      const handle = buildSentryMiddleware();
      const next = jest.fn();
      handle.requestHandler({} as never, {} as never, next);
      expect(sentryMock.withIsolationScope).toHaveBeenCalledTimes(1);
      expect(next).toHaveBeenCalledTimes(1);
    });

    it('tracingHandler starts a span and finishes it on response close', () => {
      process.env.SENTRY_DSN = 'https://abc@o0.ingest.sentry.io/1';
      const handle = buildSentryMiddleware();
      const next = jest.fn();
      const listeners: Record<string, () => void> = {};
      const res = {
        once: jest.fn((event: string, cb: () => void) => {
          listeners[event] = cb;
        }),
      };
      handle.tracingHandler(
        { method: 'GET', path: '/foo' } as never,
        res as never,
        next,
      );
      expect(sentryMock.startSpanManual).toHaveBeenCalledWith(
        expect.objectContaining({ op: 'http.server', name: 'GET /foo' }),
        expect.any(Function),
      );
      expect(res.once).toHaveBeenCalledWith('finish', expect.any(Function));
      expect(res.once).toHaveBeenCalledWith('close', expect.any(Function));
      expect(next).toHaveBeenCalledTimes(1);
    });

    it('errorHandler captures the exception and forwards via next(err)', () => {
      process.env.SENTRY_DSN = 'https://abc@o0.ingest.sentry.io/1';
      const handle = buildSentryMiddleware();
      const next = jest.fn();
      const err = new Error('boom');
      handle.errorHandler(err, {} as never, {} as never, next);
      expect(sentryMock.captureException).toHaveBeenCalledWith(err);
      expect(next).toHaveBeenCalledWith(err);
    });

    it('errorHandler skips Sentry when disabled but still propagates the error', () => {
      delete process.env.SENTRY_DSN;
      const handle = buildSentryMiddleware();
      const next = jest.fn();
      const err = new Error('boom');
      handle.errorHandler(err, {} as never, {} as never, next);
      expect(sentryMock.captureException).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledWith(err);
    });
  });

  // -------------------------------------------------------------------------
  // applySentryMiddleware — verifies registration order on the Express adapter
  // -------------------------------------------------------------------------

  describe('applySentryMiddleware', () => {
    function makeApp(): {
      app: INestApplication;
      registrations: unknown[];
    } {
      const registrations: unknown[] = [];
      const expressInstance = {
        use: (...args: unknown[]) => {
          // Mirror Express's signature: a single middleware arg is the
          // common case. Push whatever was registered so we can assert
          // the type-shape of each entry.
          for (const a of args) registrations.push(a);
        },
      };
      const app = {
        getHttpAdapter: () => ({ getInstance: () => expressInstance }),
      } as unknown as INestApplication;
      return { app, registrations };
    }

    it('registers requestHandler, tracingHandler, then errorHandler in that order (DSN set)', () => {
      process.env.SENTRY_DSN = 'https://abc@o0.ingest.sentry.io/1';
      const { app, registrations } = makeApp();
      const handle = applySentryMiddleware(app);

      // Three middleware should be registered, in this exact order.
      expect(registrations).toHaveLength(3);
      expect(registrations[0]).toBe(handle.requestHandler);
      expect(registrations[1]).toBe(handle.tracingHandler);
      expect(registrations[2]).toBe(handle.errorHandler);
    });

    it('the third handler is a 4-arg Express error handler (err, req, res, next)', () => {
      process.env.SENTRY_DSN = 'https://abc@o0.ingest.sentry.io/1';
      const { app, registrations } = makeApp();
      applySentryMiddleware(app);
      // Express identifies error handlers by `fn.length === 4`. Confirm
      // the registered errorHandler has that arity.
      expect((registrations[2] as (...a: unknown[]) => unknown).length).toBe(
        4,
      );
    });

    it('also calls setupNestErrorHandler when DSN is set', () => {
      process.env.SENTRY_DSN = 'https://abc@o0.ingest.sentry.io/1';
      const { app } = makeApp();
      applySentryMiddleware(app);
      expect(sentryMock.setupNestErrorHandler).toHaveBeenCalledTimes(1);
    });

    it('passes the base filter to setupNestErrorHandler when provided', () => {
      process.env.SENTRY_DSN = 'https://abc@o0.ingest.sentry.io/1';
      const { app } = makeApp();
      const baseFilter = { catch: jest.fn() };
      applySentryMiddleware(app, baseFilter);
      expect(sentryMock.setupNestErrorHandler).toHaveBeenCalledWith(
        app,
        baseFilter,
      );
    });

    it('does NOT call setupNestErrorHandler when DSN is unset', () => {
      delete process.env.SENTRY_DSN;
      const { app } = makeApp();
      applySentryMiddleware(app);
      expect(sentryMock.setupNestErrorHandler).not.toHaveBeenCalled();
    });

    it('still registers no-op middleware (same shape) when DSN unset', () => {
      delete process.env.SENTRY_DSN;
      const { app, registrations } = makeApp();
      applySentryMiddleware(app);
      // Same wiring shape so dev and prod boot paths are identical —
      // makes "it works in dev but not prod" bugs harder to introduce.
      expect(registrations).toHaveLength(3);
    });

    it('NEVER calls Sentry.setUser — preserves "Not Linked" privacy posture', () => {
      // This is enforced by the absence of a setUser call across the module
      // (privacy-by-design). Walk the module's source, strip comments, and
      // confirm no `setUser` symbol is referenced in executable code.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const fs = require('fs') as typeof import('fs');
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const path = require('path') as typeof import('path');
      const src = fs.readFileSync(
        path.join(__dirname, 'sentry.module.ts'),
        'utf8',
      );
      // Strip /* ... */ block comments and // line comments so the
      // assertion focuses on actual code, not documentation about why
      // we don't call setUser.
      const codeOnly = src
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1');
      expect(codeOnly).not.toMatch(/Sentry\s*\.\s*setUser\s*\(/);
    });
  });
});
