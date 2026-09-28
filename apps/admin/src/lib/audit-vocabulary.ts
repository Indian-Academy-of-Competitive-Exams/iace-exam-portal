import { type AuditAction } from '@iace/contracts';

/** The audit trail's own vocabulary, apart from the cells that render it so fast refresh works. */

/** The same badge vocabulary as the rest of the app: what undoes something reads as a warning or worse. */
export const ACTION_BADGE_VARIANT: Readonly<
  Record<AuditAction, 'neutral' | 'success' | 'warning' | 'danger' | 'info'>
> = {
  CREATE: 'success',
  UPDATE: 'neutral',
  DELETE: 'danger',
  ACTIVATE: 'success',
  DEACTIVATE: 'warning',
  BLOCK: 'danger',
  UNBLOCK: 'success',
  IMPORT: 'info',
  EXPORT: 'info',
};
