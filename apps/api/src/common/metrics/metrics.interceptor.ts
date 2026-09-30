import {
  Injectable,
  Logger,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { type Request, type Response } from 'express';
import { type Observable, tap } from 'rxjs';
import { ensureRequestId, type RequestWithId } from '../request-id';
import { type AuthenticatedUser } from '../security/authenticated-user';
import { MetricsService } from './metrics.service';

/** The route PATTERN, never the URL: `/me/attempts/:id` is one series, and 5,000 ids are not. */
const routeOf = (request: Request): string =>
  (request.route as { path?: string } | undefined)?.path ?? 'unmatched';

/** A success this slow is the only thing production hears about a call that worked. */
const SLOW_REQUEST_MS = 1_000;

type ObservedRequest = RequestWithId & { user?: AuthenticatedUser };

/** The one observer on every request: the latency histogram, and the line that says a call happened. */
@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  private readonly logger = new Logger('Request');

  constructor(private readonly metrics: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    const http = context.switchToHttp();
    const request = http.getRequest<ObservedRequest>();
    const response = http.getResponse<Response>();
    const started = process.hrtime.bigint();

    const observe = (status: number) => {
      const ms = Number(process.hrtime.bigint() - started) / 1e6;
      this.metrics.observeRequest(request.method, routeOf(request), status, ms / 1000);
      // Failures belong to AllExceptionsFilter, which has the code, the stack and the body.
      if (status < 400) this.record(request, status, ms);
    };

    return next.handle().pipe(
      tap({
        next: () => observe(response.statusCode),
        // The filter has not run yet, so the status is read off the exception rather than the response.
        error: (error: unknown) => observe(statusOf(error)),
      }),
    );
  }

  /** `warn` when it dragged, `debug` otherwise — which is how production's `>=log` drops the flood. */
  private record(request: ObservedRequest, status: number, ms: number): void {
    const rounded = Math.round(ms);
    // One string, not a second argument: this Nest emits each extra param as its own log line.
    const who = request.user ? `${request.user.actor}:${request.user.id}` : 'anonymous';
    const line = `${request.method} ${routeOf(request)} → ${status} ${rounded}ms ${who} [${ensureRequestId(request)}]`;

    if (rounded >= SLOW_REQUEST_MS) this.logger.warn(`${line} SLOW`);
    else this.logger.debug(line);
  }
}

function statusOf(error: unknown): number {
  const status =
    (error as { httpStatus?: number; status?: number })?.httpStatus ??
    (error as { status?: number })?.status;
  return typeof status === 'number' ? status : 500;
}
