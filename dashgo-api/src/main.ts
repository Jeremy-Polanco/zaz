// Sentry must be imported FIRST so its async hooks instrument the process before
// anything else loads. Order matters — do not move this below other imports.
import './instrument';

import 'reflect-metadata';
import { ValidationPipe, Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const helmet = require('helmet');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const compression = require('compression');
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { applySentryMiddleware } from './common/sentry/sentry.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    rawBody: true,
    cors: {
      origin: (process.env.CORS_ORIGIN ?? 'http://localhost:5173')
        .split(',')
        .map((s) => s.trim()),
      credentials: true,
    },
  });

  // crossOriginResourcePolicy defaults to 'same-origin', which makes browsers
  // refuse to render product/category images embedded from a different origin
  // (e.g. the Vercel-hosted web client loading /products/:id/image from this
  // API). The image endpoints are explicitly @Public(), so opting them in to
  // cross-origin loads is the intended posture.
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(compression());

  // Sentry middleware MUST be wired before routes (request + tracing
  // handlers) and the error handler MUST run last. `applySentryMiddleware`
  // owns that ordering — see sentry.module.ts for the rationale. When
  // SENTRY_DSN is unset the handlers are inert no-ops, so this stays a
  // single-shape boot path in dev and prod.
  //
  // The AllExceptionsFilter is the base filter wrapped by Sentry's Nest
  // integration. Without that wrap, Sentry doesn't see exceptions that
  // the global filter catches and formats.
  const allExceptionsFilter = new AllExceptionsFilter();
  applySentryMiddleware(app, allExceptionsFilter);

  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );
  app.useGlobalFilters(allExceptionsFilter);

  const port = parseInt(process.env.API_PORT ?? '3001', 10);
  await app.listen(port, '0.0.0.0');
  Logger.log(
    `dashgo-api listening on http://0.0.0.0:${port}/api`,
    'Bootstrap',
  );
}

bootstrap();
