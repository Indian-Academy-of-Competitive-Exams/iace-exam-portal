import {
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { tap, type Observable } from 'rxjs';
import { AUDIT_ACTOR_TYPE, ActorTypes, type AuditActorType } from '@iace/contracts';
import { DomainEventBus } from '../common/events';
import { DOMAIN_EVENTS } from '../common/events/event-catalog';
import { ensureRequestId, type RequestWithId } from '../common/request-id';
import { type AuthenticatedUser } from '../common/security/authenticated-user';
import { AUDIT_KEY, resolveAuditAction, type AuditRoute } from './audit.decorator';
import { AuditContext } from './audit.context';

type AuditedRequest = RequestWithId & {
  user?: AuthenticatedUser;
  params?: Record<string, string>;
  body?: unknown;
};

/**
 * Registered AFTER ResponseInterceptor so it is inner and sees the handler's own return value
 * rather than the wrapped envelope. It never writes — the listener does.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly context: AuditContext,
    private readonly events: DomainEventBus,
  ) {}

  intercept(execution: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (execution.getType() !== 'http') return next.handle();

    const route = this.reflector.getAllAndOverride<AuditRoute | undefined>(AUDIT_KEY, [
      execution.getHandler(),
      execution.getClass(),
    ]);
    if (!route) return next.handle();

    const request = execution.switchToHttp().getRequest<AuditedRequest>();

    return next.handle().pipe(tap((payload: unknown) => this.emit(route, request, payload)));
  }

  private emit(route: AuditRoute, request: AuditedRequest, payload: unknown): void {
    const store = this.context.current();
    const entityId = store?.entityId ?? request.params?.id ?? idOf(payload);
    if (!entityId) return;

    this.events.emit(DOMAIN_EVENTS.AUDIT_ROW_ACTION, {
      feature: route.feature,
      action: store?.action ?? resolveAuditAction(route, request.body),
      entityId,
      actorType: actorTypeOf(request.user),
      actorId: request.user?.id ?? null,
      changed: store?.changed ?? null,
      importLogId: store?.importLogId ?? null,
      requestId: ensureRequestId(request),
    });
  }
}

function idOf(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const id = (payload as { id?: unknown }).id;
  return typeof id === 'string' ? id : null;
}

function actorTypeOf(user: AuthenticatedUser | undefined): AuditActorType {
  // No token is not an admin. Defaulting to ADMIN made the log name somebody who did nothing.
  if (!user) return AUDIT_ACTOR_TYPE.SCRIPT;
  return user.actor === ActorTypes.STUDENT ? AUDIT_ACTOR_TYPE.STUDENT : AUDIT_ACTOR_TYPE.ADMIN;
}
