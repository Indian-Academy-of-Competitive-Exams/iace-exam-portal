import { Link } from 'react-router-dom';
import { type RowAction } from '@iace/contracts';
import { Badge, BadgeList, linkVariants, TruncatedText } from '@iace/ui';
import { ROUTES } from './constants';

/** One rendering of a `RowAction`, shared by every screen that shows one. */

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
 * An import-sourced row carries no diff — `recordImportRows` writes one thin entry per touched
 * entity, by design — so it links to Import runs, where that run's status and counts live.
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
      <Link to={`${ROUTES.AUDIT_IMPORTS}?run=${row.importLogId}`} className={linkVariants()}>
        From an import — view run
      </Link>
    );
  }

  return <span className="text-muted-foreground">—</span>;
}
