import { INSTITUTE_TIME_ZONE, type AuditAction } from '@iace/contracts';

/** The audit trail's own vocabulary, apart from the cells that render it so fast refresh works. */

export const WHEN_FORMATTER = new Intl.DateTimeFormat(undefined, {
  timeZone: INSTITUTE_TIME_ZONE,
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

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
};
