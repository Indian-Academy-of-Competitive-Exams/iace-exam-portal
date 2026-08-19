import { Link } from 'react-router-dom';
import type { AuditAction, RowAction } from '@iace/contracts';
import { Badge, BadgeList, linkVariants, TruncatedText } from '@iace/ui';
import { AUDIT_TAB, ROUTES } from './constants';

/**
 * How an audit row renders, shared by the global Audit screen and any per-entity
 * history card (`EntityHistory`) — one rendering of a `RowAction`, not two.
 */

export const WHEN_FORMATTER = new Intl.DateTimeFormat(undefined, {
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

function formatDiffValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string') return value;
  if (typeof value === 'boolean' || typeof value === 'number') return String(value);
  return JSON.stringify(value);
}

function diffLabel(field: string, diff: { from: unknown; to: unknown }): string {
  return `${field}: ${formatDiffValue(diff.from)} → ${formatDiffValue(diff.to)}`;
}

/**
 * Diffs render as `field: from → to`, capped and truncated the same way `AccessCell`
 * (`students.tsx`) caps a badge row — a rich-text question diff is exactly the kind of value
 * that must not force the row wide. An import-sourced row carries no diff at all —
 * `recordImportRows` writes one thin entry per touched entity, by design — so it links to the
 * Imports tab, which is where that run's actual status and counts live.
 */
export function ChangedCell({ row }: Readonly<{ row: RowAction }>) {
  if (row.changed) {
    const entries = Object.entries(row.changed);
    return (
      <BadgeList
        items={entries}
        label={([field, diff]) => diffLabel(field, diff)}
        max={2}
        className="max-w-[22rem]"
      >
        {([field, diff]) => (
          <Badge className="min-w-0 shrink">
            <TruncatedText>{diffLabel(field, diff)}</TruncatedText>
          </Badge>
        )}
      </BadgeList>
    );
  }

  if (row.importLogId) {
    return (
      <Link
        to={`${ROUTES.AUDIT}?tab=${AUDIT_TAB.IMPORTS}&run=${row.importLogId}`}
        className={linkVariants()}
      >
        From an import — view run
      </Link>
    );
  }

  return <span className="text-muted-foreground">—</span>;
}
