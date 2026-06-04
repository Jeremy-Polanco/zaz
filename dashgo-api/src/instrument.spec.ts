/**
 * Verifies that `instrument.ts` calls `Sentry.init()` with the right
 * `release` tag so uploaded source maps can be matched back to runtime
 * events. The actual SDK is mocked at the module boundary — we're testing
 * the WIRING (env → init args), not the Sentry SDK itself.
 *
 * Why this matters:
 *   If `release` is missing, Sentry has no way to look up the uploaded
 *   sourcemap bundle for an incoming stack trace. Events still arrive,
 *   but frames stay minified. That defeats the whole point of uploading
 *   maps in CI. See instrument.ts for the priority order.
 */

// Mock the Sentry SDK BEFORE importing the module under test, so the
// `Sentry.init()` call at module scope is observable.
jest.mock('@sentry/node', () => ({
  init: jest.fn(),
}));
jest.mock('@sentry/profiling-node', () => ({
  nodeProfilingIntegration: jest.fn(() => ({ name: 'ProfilingMock' })),
}));

import * as Sentry from '@sentry/node';

const sentryMock = Sentry as unknown as { init: jest.Mock };

/**
 * `instrument.ts` calls `Sentry.init()` once at module scope, so to test
 * different env configurations we need to re-import a fresh copy after
 * mutating `process.env`. `jest.isolateModules` gives each call its own
 * module registry, which re-runs the side-effect.
 */
function loadInstrumentFresh() {
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('./instrument');
  });
}

describe('instrument.ts — Sentry release/dist tagging', () => {
  // Snapshot env so test mutations don't leak across files.
  const originalEnv = { ...process.env };

  beforeEach(() => {
    sentryMock.init.mockClear();
    // Reset to a clean slate; each test sets only what it needs.
    process.env = { ...originalEnv };
    delete process.env.SENTRY_RELEASE;
    delete process.env.SENTRY_DSN;
    delete process.env.npm_package_version;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('skips Sentry.init entirely when SENTRY_DSN is unset', () => {
    loadInstrumentFresh();
    expect(sentryMock.init).not.toHaveBeenCalled();
  });

  it('uses SENTRY_RELEASE when provided (highest priority)', () => {
    process.env.SENTRY_DSN = 'https://abc@o0.ingest.sentry.io/0';
    process.env.SENTRY_RELEASE = 'dashgo-api@1.2.3+sha9f9';
    process.env.npm_package_version = '0.0.1'; // should be ignored

    loadInstrumentFresh();

    expect(sentryMock.init).toHaveBeenCalledTimes(1);
    const initArgs = sentryMock.init.mock.calls[0][0];
    expect(initArgs.release).toBe('dashgo-api@1.2.3+sha9f9');
  });

  it('falls back to npm_package_version when SENTRY_RELEASE is unset', () => {
    process.env.SENTRY_DSN = 'https://abc@o0.ingest.sentry.io/0';
    process.env.npm_package_version = '1.0.0';

    loadInstrumentFresh();

    expect(sentryMock.init).toHaveBeenCalledTimes(1);
    const initArgs = sentryMock.init.mock.calls[0][0];
    expect(initArgs.release).toBe('1.0.0');
  });

  it('passes release: undefined when neither SENTRY_RELEASE nor npm_package_version is set', () => {
    // This branch matches a build where neither the deploy pipeline nor
    // npm started the process — Sentry will still ingest events but won't
    // be able to symbolicate from uploaded maps. Documented tradeoff.
    process.env.SENTRY_DSN = 'https://abc@o0.ingest.sentry.io/0';

    loadInstrumentFresh();

    expect(sentryMock.init).toHaveBeenCalledTimes(1);
    const initArgs = sentryMock.init.mock.calls[0][0];
    expect(initArgs.release).toBeUndefined();
  });

  it('forwards environment from NODE_ENV', () => {
    process.env.SENTRY_DSN = 'https://abc@o0.ingest.sentry.io/0';
    process.env.NODE_ENV = 'production';
    process.env.SENTRY_RELEASE = 'rel-1';

    loadInstrumentFresh();

    expect(sentryMock.init).toHaveBeenCalledTimes(1);
    const initArgs = sentryMock.init.mock.calls[0][0];
    expect(initArgs.environment).toBe('production');
  });

  it('keeps PII off by default and includes the profiling integration', () => {
    process.env.SENTRY_DSN = 'https://abc@o0.ingest.sentry.io/0';
    process.env.SENTRY_RELEASE = 'rel-1';

    loadInstrumentFresh();

    const initArgs = sentryMock.init.mock.calls[0][0];
    expect(initArgs.sendDefaultPii).toBe(false);
    expect(Array.isArray(initArgs.integrations)).toBe(true);
    expect(initArgs.integrations.length).toBeGreaterThan(0);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// NC1 fix: PII scrubbing via beforeSend / beforeBreadcrumb.
//
// sendDefaultPii: false is necessary but not sufficient — it doesn't scrub
// request.data, query strings on request.url, or extra/context payloads
// that callers hand to captureException. These tests pin the WIRING:
// that the hooks exist on the init options, and that they apply the
// scrubber across every leaky surface.
//
// The scrubber's own correctness (depth limit, key matching, array
// preservation) is exhaustively covered in common/sentry/scrub.spec.ts —
// this file just verifies the hooks call into it from each surface.
// ──────────────────────────────────────────────────────────────────────────
describe('instrument.ts — Sentry PII scrubbing (NC1)', () => {
  type InitOpts = {
    beforeSend?: (e: Record<string, unknown>) => Record<string, unknown> | null;
    beforeBreadcrumb?: (
      b: Record<string, unknown>,
    ) => Record<string, unknown> | null;
  };

  const originalEnv = { ...process.env };

  function freshInitOpts(): InitOpts {
    sentryMock.init.mockClear();
    process.env.SENTRY_DSN = 'https://abc@o0.ingest.sentry.io/0';
    process.env.SENTRY_RELEASE = 'rel-pii';
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('./instrument');
    });
    expect(sentryMock.init).toHaveBeenCalledTimes(1);
    return sentryMock.init.mock.calls[0][0] as InitOpts;
  }

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('exposes beforeSend and beforeBreadcrumb hooks on init', () => {
    const opts = freshInitOpts();
    expect(typeof opts.beforeSend).toBe('function');
    expect(typeof opts.beforeBreadcrumb).toBe('function');
  });

  describe('beforeSend', () => {
    it('redacts sensitive keys in request.data and headers, and strips query from request.url', () => {
      const opts = freshInitOpts();
      const event = {
        request: {
          data: {
            phone: '+15145551212',
            otp: '123456',
            payload: { access_token: 'eyJ...' },
          },
          headers: { authorization: 'Bearer abc', host: 'api.example.com' },
          cookies: 'sid=xyz',
          query_string: 'phone=%2B&code=123456',
          url: '/api/auth/verify-otp?phone=%2B&code=123456',
        },
      };

      const out = opts.beforeSend!(event) as {
        request: {
          data: {
            phone: string;
            otp: string;
            payload: { access_token: string };
          };
          headers: Record<string, string>;
          cookies: string;
          query_string: string;
          url: string;
        };
      };

      expect(out.request.data.phone).toBe('[redacted]');
      expect(out.request.data.otp).toBe('[redacted]');
      expect(out.request.data.payload.access_token).toBe('[redacted]');
      expect(out.request.headers.authorization).toBe('[redacted]');
      expect(out.request.headers.host).toBe('api.example.com');
      expect(out.request.cookies).toBe('[redacted]');
      expect(out.request.query_string).toBe('[redacted]');
      expect(out.request.url).toBe('/api/auth/verify-otp');
    });

    it('scrubs extra and contexts', () => {
      const opts = freshInitOpts();
      const event = {
        extra: { otp_code: '999000', visible: 'ok' },
        contexts: {
          request: { phone: '+1', method: 'POST' },
        },
      };
      const out = opts.beforeSend!(event) as {
        extra: { otp_code: string; visible: string };
        contexts: { request: { phone: string; method: string } };
      };
      expect(out.extra.otp_code).toBe('[redacted]');
      expect(out.extra.visible).toBe('ok');
      expect(out.contexts.request.phone).toBe('[redacted]');
      expect(out.contexts.request.method).toBe('POST');
    });

    it('scrubs breadcrumb data carried inside an event', () => {
      const opts = freshInitOpts();
      const event = {
        breadcrumbs: [
          { category: 'http', data: { phone: '+1', method: 'GET' } },
          { category: 'log', message: 'hello' },
        ],
      };
      const out = opts.beforeSend!(event) as {
        breadcrumbs: { data?: { phone?: string; method?: string } }[];
      };
      expect(out.breadcrumbs[0].data?.phone).toBe('[redacted]');
      expect(out.breadcrumbs[0].data?.method).toBe('GET');
    });

    it('does not throw on an empty event shape', () => {
      const opts = freshInitOpts();
      expect(() => opts.beforeSend!({})).not.toThrow();
    });
  });

  describe('beforeBreadcrumb', () => {
    it('redacts sensitive data keys and strips query from http URLs', () => {
      const opts = freshInitOpts();
      const crumb = {
        category: 'http',
        data: {
          url: '/api/auth/verify-otp?phone=%2B&code=123456',
          phone: '+1',
          method: 'POST',
        },
      };
      const out = opts.beforeBreadcrumb!(crumb) as {
        data: { url: string; phone: string; method: string };
      };
      expect(out.data.phone).toBe('[redacted]');
      expect(out.data.method).toBe('POST');
      expect(out.data.url).toBe('/api/auth/verify-otp');
    });

    it('does not strip URLs on non-http breadcrumb categories', () => {
      const opts = freshInitOpts();
      const crumb = {
        category: 'navigation',
        data: { from: '/a?x=1', to: '/b?y=2' },
      };
      const out = opts.beforeBreadcrumb!(crumb) as {
        data: { from: string; to: string };
      };
      expect(out.data.from).toBe('/a?x=1');
      expect(out.data.to).toBe('/b?y=2');
    });

    it('passes through a breadcrumb with no data field without throwing', () => {
      const opts = freshInitOpts();
      expect(() =>
        opts.beforeBreadcrumb!({ category: 'log', message: 'hello' }),
      ).not.toThrow();
    });
  });
});
