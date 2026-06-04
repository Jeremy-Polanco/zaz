import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Res,
  ServiceUnavailableException,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Response } from 'express';
import { DataSource } from 'typeorm';
import { Public } from '../common/decorators/public.decorator';

/**
 * Probe outcome for a single dependency.
 *
 * 'ok' = probe succeeded within budget.
 * 'fail' = probe threw, returned an error, or timed out.
 */
type ProbeStatus = 'ok' | 'fail';

interface HealthResponse {
  status: 'ok' | 'degraded';
  uptime: number;
  checks: Record<string, ProbeStatus>;
}

/**
 * Default budget for the DB SELECT 1 probe.
 *
 * Kept tight so load-balancer health checks (usually polled on 5-10s intervals
 * with a 3-5s timeout) get a fast 503 instead of hanging until their own
 * timeout. Anything beyond ~2s is already a hard signal the DB is unhealthy.
 */
const DB_PROBE_TIMEOUT_MS = 2_000;

/**
 * Liveness/readiness probe used by App Store Connect, Render, and any reverse
 * proxy in front of the API.
 *
 * Returns 200 only when every required dependency is reachable. A failed probe
 * (including timeouts) returns 503 so upstream traffic shifters can take this
 * pod out of rotation. The response body always lists every probe so operators
 * can tell which dependency is degraded.
 *
 * The endpoint is exempt from JWT auth (@Public) and from the global IP
 * throttler (@SkipThrottle) — health checks must reach the app even when the
 * caller has no credentials and would otherwise burn through the IP budget.
 */
@Controller('health')
@Public()
@SkipThrottle()
export class HealthController {
  constructor(private readonly dataSource: DataSource) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  async check(@Res({ passthrough: true }) res: Response): Promise<HealthResponse> {
    const checks: Record<string, ProbeStatus> = {
      db: await this.probeDatabase(),
    };

    const allOk = Object.values(checks).every((status) => status === 'ok');
    const body: HealthResponse = {
      status: allOk ? 'ok' : 'degraded',
      uptime: process.uptime(),
      checks,
    };

    if (!allOk) {
      // Throwing ServiceUnavailableException would funnel the response through
      // AllExceptionsFilter and lose the probe breakdown. Setting the status
      // manually keeps the structured body intact for monitoring tools.
      res.status(HttpStatus.SERVICE_UNAVAILABLE);
    }

    return body;
  }

  /**
   * Runs `SELECT 1` against the active DataSource with a hard timeout.
   *
   * Both query failures and timeouts collapse to 'fail' — the caller only
   * cares "is the DB usable right now", not the failure shape.
   */
  private async probeDatabase(): Promise<ProbeStatus> {
    try {
      await withTimeout(
        this.dataSource.query('SELECT 1'),
        DB_PROBE_TIMEOUT_MS,
      );
      return 'ok';
    } catch {
      return 'fail';
    }
  }
}

/**
 * Wraps a promise in a timeout. Rejects with ServiceUnavailableException when
 * the wrapped promise does not settle in `ms` milliseconds.
 *
 * Exported for tests; not part of the controller surface.
 */
export function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new ServiceUnavailableException('probe timeout'));
    }, ms);
    // Allow the process to exit naturally if this timer is the only thing
    // left pending (e.g. during test teardown after the probe already settled).
    timer.unref?.();
  });

  return Promise.race([p, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  }) as Promise<T>;
}
