import { Injectable, type NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { type NextFunction, type Request, type Response } from 'express';

export const REQUEST_ID_HEADER = 'x-request-id';

/**
 * Only an id we would have generated ourselves is trusted from the caller —
 * bounded, and with no characters that could forge a second line in a log.
 */
const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{8,128}$/;

/** Every request carries one, from the middleware onward. */
export interface RequestWithId extends Request {
  requestId?: string;
}

/**
 * Stamps each request with an id, echoes it in `X-Request-Id`, and hands it to
 * the interceptor and the exception filter for `meta.requestId`. The same value
 * appears on the server's log line, so a user reporting an error id is one grep
 * away from the stack trace that caused it.
 *
 * An inbound id is honoured when it is well-formed, which keeps a trace intact
 * across a load balancer or the SPA's own retry.
 */
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(request: RequestWithId, response: Response, next: NextFunction): void {
    const inbound = request.headers[REQUEST_ID_HEADER];
    const claimed = Array.isArray(inbound) ? inbound[0] : inbound;

    request.requestId = claimed && SAFE_REQUEST_ID.test(claimed) ? claimed : randomUUID();
    response.setHeader(REQUEST_ID_HEADER, request.requestId);
    next();
  }
}

/**
 * Reads the id, minting one if the middleware never ran (a request rejected
 * before the stack, say). Idempotent, so the filter and the interceptor always
 * agree on the value for a given request.
 */
export function ensureRequestId(request: { requestId?: string } | undefined): string {
  if (!request) return randomUUID();
  request.requestId ??= randomUUID();
  return request.requestId;
}
