/**
 * The exam role's budget: what a live sitting's request may cost before it is refused.
 *
 * The clients already give up and send again — a submit at 10s, a save at 15s — while the server
 * gave up on nothing, so a retry landed on a container still doing the first copy of the work.
 */
import {
  Injectable,
  Logger,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { throwError, timeout, type Observable } from 'rxjs';
import { AppException, ErrorCodes } from '@iace/contracts';
import { API_ROLES, apiRole } from '../config/api-role';
import { type RequestWithId } from './request-id';

/** Under the paper's own SUBMIT_TIMEOUT_MS, so the server answers before the screen stops waiting. */
export const REQUEST_BUDGET_MS = 8_000;

/** Under the budget, so a query that ran long is the error the caller sees and not a bare timeout. */
export const STATEMENT_TIMEOUT_MS = 6_000;

/** Postgres cancels the statement and frees the backend; a client-side give-up leaves it running. */
export function withStatementTimeout(url: string, ms: number = STATEMENT_TIMEOUT_MS): string {
  // An operator who set their own options meant them, and a second `options` would be ignored anyway.
  if (url.includes('options=')) return url;
  const options = encodeURIComponent(`-c statement_timeout=${ms}`);
  return `${url}${url.includes('?') ? '&' : '?'}options=${options}`;
}

/** A 503, which the paper's own retry rule already counts as an answer worth asking for again. */
export function underBudget<T>(
  source: Observable<T>,
  budgetMs: number,
  refused: () => void,
): Observable<T> {
  if (budgetMs <= 0) return source;
  return source.pipe(
    timeout({
      each: budgetMs,
      with: () => {
        refused();
        return throwError(() => new AppException(ErrorCodes.SERVICE_UNAVAILABLE));
      },
    }),
  );
}

/** The exam role EXACTLY, never servesRole: under ALL the scoring sweeps share this process for minutes at a time. */
export const examBudgetMs = (role = apiRole): number =>
  role === API_ROLES.EXAM ? REQUEST_BUDGET_MS : 0;

/** Bounds what a candidate waits, so a refusal they can retry arrives instead of a request nobody ends. */
@Injectable()
export class RequestBudgetInterceptor implements NestInterceptor {
  private readonly logger = new Logger(RequestBudgetInterceptor.name);
  private readonly budgetMs = examBudgetMs();

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (this.budgetMs === 0 || context.getType() !== 'http') return next.handle();

    const request = context.switchToHttp().getRequest<RequestWithId>();
    return underBudget(next.handle(), this.budgetMs, () =>
      this.logger.warn(`${request.method} ${request.originalUrl} gave up at ${this.budgetMs}ms`),
    );
  }
}
