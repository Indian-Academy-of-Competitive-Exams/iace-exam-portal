import { Injectable, type NestMiddleware } from '@nestjs/common';
import { type NextFunction, type Request, type Response } from 'express';
import { AuditContext } from './audit.context';

/** Middleware, not an interceptor: `next()` runs the whole request inside the store. */
@Injectable()
export class AuditContextMiddleware implements NestMiddleware {
  constructor(private readonly context: AuditContext) {}

  use(_request: Request, _response: Response, next: NextFunction): void {
    this.context.run(() => next());
  }
}
