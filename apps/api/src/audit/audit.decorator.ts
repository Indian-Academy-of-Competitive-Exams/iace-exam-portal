import { SetMetadata } from '@nestjs/common';
import { AUDIT_ACTION, type AuditAction, type AuditFeature } from '@iace/contracts';

export const AUDIT_KEY = 'audit:route';

export type AuditActionResolver = (body: Record<string, unknown>) => AuditAction;

export interface AuditRoute {
  feature: AuditFeature;
  action: AuditAction | AuditActionResolver;
}

/** What a write route means in audit terms. Metadata only — the interceptor does the work. */
export const Audit = (feature: AuditFeature, action: AuditAction | AuditActionResolver) =>
  SetMetadata(AUDIT_KEY, { feature, action } satisfies AuditRoute);

/** The two toggles whose action cannot be named statically.
 * isActive true = permitted; isTestBlocked true = forbidden, so the resolvers' fallbacks differ. */
export const TOGGLE_ACTIONS = {
  signIn: (body: Record<string, unknown>): AuditAction =>
    body.isActive === true ? AUDIT_ACTION.ACTIVATE : AUDIT_ACTION.DEACTIVATE,
  tests: (body: Record<string, unknown>): AuditAction =>
    body.isTestBlocked === true ? AUDIT_ACTION.BLOCK : AUDIT_ACTION.UNBLOCK,
} as const;

export function resolveAuditAction(route: AuditRoute, body: unknown): AuditAction {
  if (typeof route.action !== 'function') return route.action;

  const safeBody =
    typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
  return route.action(safeBody);
}
