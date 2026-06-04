import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import * as Sentry from '@sentry/node';
import { stripQueryString } from '../sentry/scrub';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status: number;
    let message: string;
    let errorCode: string | undefined;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse();
      if (typeof res === 'string') {
        message = res;
      } else {
        const obj = res as Record<string, unknown>;
        message = obj.message?.toString() ?? exception.message;
        if (typeof obj.code === 'string') errorCode = obj.code;
      }
    } else {
      status = HttpStatus.INTERNAL_SERVER_ERROR;
      message =
        process.env.NODE_ENV !== 'production'
          ? String(exception)
          : 'Internal server error';
    }

    // HIGH-severity privacy fix: strip the query string from request.url
    // before it lands anywhere observable (Sentry context, logs, response
    // body). Hot path: `/api/auth/verify-otp?phone=%2B...&code=123456` —
    // attaching raw `request.url` leaks the OTP and phone number into
    // Sentry events and the logger output.
    //
    // Express's `request.url` includes the query string verbatim. The
    // path-only form is what we want for diagnostics; the query string is
    // never useful for an error report and is almost always PII-bearing.
    const safeUrl = stripQueryString(request.url);

    // Report 5xx (and unhandled) errors to Sentry. 4xx are client errors and
    // typically not worth reporting — they're noise.
    if (status >= 500) {
      Sentry.captureException(exception, {
        contexts: {
          request: {
            method: request.method,
            url: safeUrl,
          },
        },
      });
    }

    this.logger.error(
      `${request.method} ${safeUrl} → ${status}`,
      exception instanceof Error ? exception.stack : String(exception),
    );

    response.status(status).json({
      statusCode: status,
      ...(errorCode ? { code: errorCode } : {}),
      message,
      timestamp: new Date().toISOString(),
      path: safeUrl,
    });
  }
}
