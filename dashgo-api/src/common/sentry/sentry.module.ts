/**
 * Sentry wiring for dashgo-api.
 *
 * The actual `Sentry.init()` call lives in `src/instrument.ts` so it runs
 * BEFORE Nest's bootstrap. That is non-negotiable: @sentry/node patches
 * Node's `http`/`https` modules on first import, and any other module loaded
 * earlier escapes the instrumentation. This module is responsible for the
 * REST of the Sentry lifecycle inside Nest:
 *
 *   1. `initSentry()` — re-runs init when called outside the entry script
 *      (e.g. tests that bypass `import './instrument'`). It's idempotent
 *      via `Sentry.isInitialized()` so calling it twice is safe.
 *   2. `applySentryMiddleware(app)` — registers request/tracing middleware
 *      BEFORE all routes, and an error handler AFTER all routes. In Sentry
 *      SDK v8 the legacy `Sentry.Handlers.requestHandler()` /
 *      `tracingHandler()` / `errorHandler()` middleware have been collapsed
 *      into automatic OpenTelemetry instrumentation + a Nest-specific
 *      `setupNestErrorHandler(app)`. We mirror the v7 three-middleware
 *      ordering with thin wrappers so the wiring is verifiable in tests
 *      and so future contributors don't have to grok the OTEL handoff.
 *   3. Privacy posture: this module deliberately does NOT identify users
 *      to Sentry. The mobile app declares "Not Linked" data in its Apple
 *      privacy manifest — sending phone/email to Sentry would contradict
 *      that. If a future feature needs user context, scrub the PII first
 *      or override per-event with a hashed identifier.
 */
import { INestApplication, Module } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import * as Sentry from '@sentry/node';

export interface SentryMiddlewareHandle {
  /** Express handler that opens a per-request Sentry isolation scope. */
  requestHandler: (req: Request, res: Response, next: NextFunction) => void;
  /** Express handler that opens a tracing span for the request. */
  tracingHandler: (req: Request, res: Response, next: NextFunction) => void;
  /** Express error handler — captures unhandled errors to Sentry. */
  errorHandler: (
    err: unknown,
    req: Request,
    res: Response,
    next: NextFunction,
  ) => void;
  /** True when Sentry was actually initialized (DSN set). */
  enabled: boolean;
}

/**
 * Idempotent init helper. The PRIMARY init happens in `src/instrument.ts`
 * before anything else loads. This is a belt-and-braces wrapper for tests
 * and for code paths that bypass the entry script.
 */
export function initSentry(): boolean {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return false;
  if (Sentry.isInitialized()) return true;

  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? 'development',
    tracesSampleRate: parseFloat(
      process.env.SENTRY_TRACES_SAMPLE_RATE ?? '0.1',
    ),
    profilesSampleRate: parseFloat(
      process.env.SENTRY_PROFILES_SAMPLE_RATE ?? '0.1',
    ),
    sendDefaultPii: false,
  });
  return true;
}

/**
 * Build the three Express middleware (request / tracing / error). When
 * SENTRY_DSN is unset the handlers are inert no-ops so they're cheap to
 * register unconditionally.
 *
 * Why we still expose three separate handlers in v8:
 *   - The legacy v7 API was `Sentry.Handlers.{request,tracing,error}Handler`.
 *     v8 dropped the request/tracing wrappers because OpenTelemetry covers
 *     them, but downstream code (and our tests) still want to verify
 *     "before-routes" vs "after-routes" ordering.
 *   - Keeping the names also makes future migration to a different APM
 *     vendor a one-file change.
 */
export function buildSentryMiddleware(): SentryMiddlewareHandle {
  const enabled = !!process.env.SENTRY_DSN;

  const requestHandler = (
    _req: Request,
    _res: Response,
    next: NextFunction,
  ): void => {
    if (!enabled) return next();
    // Open an isolation scope per request so any breadcrumbs / tags / spans
    // attached during this request don't leak into concurrent requests.
    Sentry.withIsolationScope(() => {
      next();
    });
  };

  const tracingHandler = (
    req: Request,
    _res: Response,
    next: NextFunction,
  ): void => {
    if (!enabled) return next();
    // Start an inactive span so it shows up as the root of the request
    // trace in Sentry. OpenTelemetry auto-instrumentation will attach
    // child spans (DB queries, outbound HTTP) underneath.
    Sentry.startSpanManual(
      {
        op: 'http.server',
        name: `${req.method} ${req.path}`,
      },
      (span) => {
        // Finish the span when the response finishes. We don't await
        // anything — just attach the listener and call next() so the
        // request flows downstream immediately.
        if (span) {
          const finish = (): void => {
            span.end();
          };
          _res.once('finish', finish);
          _res.once('close', finish);
        }
        next();
      },
    );
  };

  const errorHandler = (
    err: unknown,
    _req: Request,
    _res: Response,
    next: NextFunction,
  ): void => {
    if (!enabled) return next(err);
    // Capture and rethrow. Nest's own AllExceptionsFilter still gets to
    // format the response — we only forward to Sentry here.
    Sentry.captureException(err);
    next(err);
  };

  return { requestHandler, tracingHandler, errorHandler, enabled };
}

/**
 * Wire Sentry middleware into a Nest app. Call this AFTER `NestFactory.create`
 * but BEFORE `app.listen`. The order of registration matters:
 *   1. requestHandler — opens a per-request isolation scope
 *   2. tracingHandler — opens a root span for the request
 *   3. <routes / Nest controllers run here>
 *   4. errorHandler — captures any errors that escaped the route handlers
 *   5. setupNestErrorHandler — Sentry's v8 Nest integration; hooks the
 *      Nest exception filter chain so errors caught by AllExceptionsFilter
 *      still make it to Sentry (the request handler chain above only sees
 *      errors that escape Nest's own error boundary).
 *
 * Returns the middleware handle so tests can inspect ordering. When
 * SENTRY_DSN is unset, the function still runs (registering no-op handlers)
 * so the wiring shape is identical between dev and prod — easier to debug.
 */
export function applySentryMiddleware(
  app: INestApplication,
  baseFilter?: { catch: (exception: unknown, host: unknown) => void },
): SentryMiddlewareHandle {
  const handle = buildSentryMiddleware();

  // Express handle. Nest wraps Express by default; `getHttpAdapter` exposes
  // the raw instance so we can `.use()` straight onto it.
  const httpAdapter = app.getHttpAdapter();
  const instance = httpAdapter.getInstance() as {
    use: (...args: unknown[]) => void;
  };

  instance.use(handle.requestHandler);
  instance.use(handle.tracingHandler);

  // The error handler must be the LAST piece of middleware. Express only
  // routes errors to a 4-arg handler if every preceding middleware has
  // already run, so registration order is load-bearing.
  //
  // We register it twice on purpose:
  //   1. Our wrapper `errorHandler` — keeps the v7-style hook point so
  //      tests can verify ordering and future migrations have a seam.
  //   2. `Sentry.setupNestErrorHandler(app, base)` — Sentry v8's Nest-aware
  //      hook that wraps a base exception filter so errors caught by the
  //      filter chain still make it to Sentry. The wrapper handler above
  //      only sees errors that escape Nest's own error boundary; this
  //      catches the ones AllExceptionsFilter handles directly.
  instance.use(handle.errorHandler);

  if (handle.enabled) {
    // When the caller didn't pass a base filter (e.g. tests), give Sentry
    // a no-op filter to wrap. The real production path passes
    // AllExceptionsFilter — see main.ts.
    const filter =
      baseFilter ?? {
        catch: (): void => {
          // no-op; the real filter is set via app.useGlobalFilters
        },
      };
    // setupNestErrorHandler is deprecated in v8 (Sentry recommends the
    // @sentry/nestjs package), but the migration target adds a peer-dep
    // on Nest internals that bumps our installed Nest version. The v8
    // hook keeps working and the deprecation is silent at runtime.
    Sentry.setupNestErrorHandler(app, filter);
  }

  return handle;
}

/**
 * Empty Nest module — exists so Sentry shows up in the module graph for
 * tooling (Nest devtools, dependency visualizers). The actual wiring is
 * done via `applySentryMiddleware` in main.ts because Sentry must be
 * initialized before AppModule loads, and Nest modules can't run that
 * early in the lifecycle.
 */
@Module({})
export class SentryModule {}
