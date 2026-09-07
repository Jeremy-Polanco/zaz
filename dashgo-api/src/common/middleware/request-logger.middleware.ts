import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

@Injectable()
export class RequestLoggerMiddleware implements NestMiddleware {
  private readonly logger = new Logger('HTTP');

  use(req: Request, res: Response, next: NextFunction) {
    // Skip health endpoint to avoid log noise
    if (req.url === '/api/health' || req.url === '/health') {
      return next();
    }

    // `req.url` is relative to the middleware mount point (it logged every
    // request as "POST / 201"); `originalUrl` is the full path the client hit.
    const { method } = req;
    const url = req.originalUrl || req.url;
    const start = Date.now();

    res.on('finish', () => {
      const duration = Date.now() - start;
      const { statusCode } = res;
      this.logger.log(`${method} ${url} ${statusCode} ${duration}ms`);
    });

    next();
  }
}
