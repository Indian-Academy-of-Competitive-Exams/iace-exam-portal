/**
 * The ONE observer of every request, in the only place that sees all of them.
 * An interceptor cannot: guards run before it, so a 401, 403 or 429 never reaches one, and a
 * body-parser 413 is thrown before a route is even chosen. `finish` fires on the response
 * whatever produced it, with the final status and the matched route already set.
 */
import { Injectable, Logger, type NestMiddleware } from '@nestjs/common';
import { type NextFunction, type Response } from 'express';
import { elapsedMs, ensureRequestId, routeOf, type RequestWithId } from '../request-id';
import { type AuthenticatedUser } from '../security/authenticated-user';
import { MetricsService } from './metrics.service';

/** A call this slow is the only thing production hears about one that worked. */
const SLOW_REQUEST_MS = 1_000;

type ObservedRequest = RequestWithId & { user?: AuthenticatedUser };

@Injectable()
export class RequestObserverMiddleware implements NestMiddleware {
  private readonly logger = new Logger('Request');

  constructor(private readonly metrics: MetricsService) {}

  use(request: ObservedRequest, response: Response, next: NextFunction): void {
    response.on('finish', () => this.record(request, response.statusCode));
    next();
  }

  /** `warn` when it failed or dragged, `debug` otherwise — which is how production's `>=log` drops the flood. */
  private record(request: ObservedRequest, status: number): void {
    const ms = elapsedMs(request);
    this.metrics.observeRequest(request.method, routeOf(request), status, ms / 1000);

    const rounded = Math.round(ms);
    // One string, not a second argument: this Nest emits each extra param as its own log line.
    const who = request.user ? `${request.user.actor}:${request.user.id}` : 'anonymous';
    const line = `${request.method} ${routeOf(request)} → ${status} ${rounded}ms ${who} [${ensureRequestId(request)}]`;

    if (status >= 400) this.logger.debug(`${line} REFUSED`);
    else if (rounded >= SLOW_REQUEST_MS) this.logger.warn(`${line} SLOW`);
    else this.logger.debug(line);
  }
}
