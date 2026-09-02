import {
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { type Request, type Response } from 'express';
import { type Observable, tap } from 'rxjs';
import { MetricsService } from './metrics.service';

/** The route PATTERN, never the URL: `/me/attempts/:id` is one series, and 5,000 ids are not. */
const routeOf = (request: Request): string =>
  (request.route as { path?: string } | undefined)?.path ?? 'unmatched';

@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  constructor(private readonly metrics: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const started = process.hrtime.bigint();

    const observe = (status: number) => {
      const seconds = Number(process.hrtime.bigint() - started) / 1e9;
      this.metrics.observeRequest(request.method, routeOf(request), status, seconds);
    };

    return next.handle().pipe(
      tap({
        next: () => observe(response.statusCode),
        // The filter has not run yet, so the status is read off the exception rather than the response.
        error: (error: unknown) => observe(statusOf(error)),
      }),
    );
  }
}

function statusOf(error: unknown): number {
  const status =
    (error as { httpStatus?: number; status?: number })?.httpStatus ??
    (error as { status?: number })?.status;
  return typeof status === 'number' ? status : 500;
}
