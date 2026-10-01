import { Injectable, type NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { type NextFunction, type Request, type Response } from 'express';
import { REQUEST_ID_HEADER } from '@iace/contracts';

/** Only an id we would have generated ourselves is trusted from the caller — bounded, and with no characters that could forge a second line in a log. */
const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{8,128}$/;

/** Every request carries one, from the middleware onward. */
export interface RequestWithId extends Request {
  requestId?: string;
  /** Stamped before the guards, so a 401 the interceptor never sees still has a duration. */
  startedAt?: bigint;
}

/** Stamps each request with an id, echoes it in `X-Request-Id`, and hands it to the interceptor and the exception filter for `meta.requestId`. */
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(request: RequestWithId, response: Response, next: NextFunction): void {
    const inbound = request.headers[REQUEST_ID_HEADER];
    const claimed = Array.isArray(inbound) ? inbound[0] : inbound;

    request.requestId = claimed && SAFE_REQUEST_ID.test(claimed) ? claimed : randomUUID();
    request.startedAt = process.hrtime.bigint();
    response.setHeader(REQUEST_ID_HEADER, request.requestId);
    next();
  }
}

/** Reads the id, minting one if the middleware never ran (a request rejected before the stack, say). Idempotent, so the filter and the interceptor always agree on the value for a given request. */
export function ensureRequestId(request: { requestId?: string } | undefined): string {
  if (!request) return randomUUID();
  request.requestId ??= randomUUID();
  return request.requestId;
}

/** The route PATTERN, never the URL: `/me/attempts/:id` is one series, and 5,000 ids are not. `unmatched` is a body-parser refusal, which is thrown before a route is chosen. */
export function routeOf(request: Request): string {
  return (request.route as { path?: string } | undefined)?.path ?? 'unmatched';
}

/** Milliseconds since the middleware stamped the request; 0 when it never ran. */
export function elapsedMs(request: RequestWithId): number {
  if (request.startedAt === undefined) return 0;
  return Number(process.hrtime.bigint() - request.startedAt) / 1e6;
}
