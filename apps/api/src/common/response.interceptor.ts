import {
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { map, type Observable } from 'rxjs';
import { isPaginated, type ApiSuccess } from '@iace/contracts';
import { ensureRequestId, type RequestWithId } from './request-id';

/** Wraps every successful handler return in the success envelope. */
@Injectable()
export class ResponseInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    // Interceptors are global across transports; only HTTP has this envelope.
    if (context.getType() !== 'http') return next.handle();

    const requestId = ensureRequestId(context.switchToHttp().getRequest<RequestWithId>());

    return next.handle().pipe(map((payload: unknown) => wrap(payload, requestId)));
  }
}

function wrap(payload: unknown, requestId: string): ApiSuccess<unknown> {
  // A list handler's counts belong in meta; its rows are the data.
  if (isPaginated(payload)) {
    const { items, page, pageSize, total } = payload;
    return { success: true, data: items, meta: { requestId, page, pageSize, total } };
  }

  // A void handler still gets a well-formed body: `data` is always present.
  return { success: true, data: payload ?? null, meta: { requestId } };
}
