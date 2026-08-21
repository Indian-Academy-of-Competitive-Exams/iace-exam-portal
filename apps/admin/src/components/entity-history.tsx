import { useQuery } from '@tanstack/react-query';
import { AUDIT_WINDOW_DAYS, type AuditFeature, type RowAction } from '@iace/contracts';
import { Alert, Badge, FormSection, Skeleton } from '@iace/ui';
import { ACTION_BADGE_VARIANT, ChangedCell, WHEN_FORMATTER } from '../lib/audit-format';
import { api } from '../lib/api';
import { AUDIT_ACTION_LABELS, AUDIT_ACTOR_TYPE_LABELS } from '../lib/constants';
import { useAuth } from '../providers/auth';

/** Enough to answer "who did this recently" without becoming its own paginated screen. */
const HISTORY_LIMIT = 10;

/** Placeholder rows have no identity of their own, so their keys are fixed. */
const PLACEHOLDER_KEYS = ['a', 'b', 'c'];

/** One entry: when, who, the action, and what changed — or where to find it. */
function HistoryRow({ row }: Readonly<{ row: RowAction }>) {
  return (
    <li className="flex flex-col gap-1.5 border-b border-border py-3 first:pt-0 last:border-b-0 last:pb-0">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge variant={ACTION_BADGE_VARIANT[row.action]}>{AUDIT_ACTION_LABELS[row.action]}</Badge>
        <span className="font-medium">
          {row.actorName ?? AUDIT_ACTOR_TYPE_LABELS[row.actorType]}
        </span>
        <span className="text-muted-foreground">
          {WHEN_FORMATTER.format(new Date(row.createdAt))}
        </span>
      </div>
      <ChangedCell row={row} />
    </li>
  );
}

/** The wait, the failure, the rows, or the empty case. An empty list has to mean empty. */
function HistoryBody({
  isPending,
  isError,
  emptyMessage,
  rows,
}: Readonly<{
  isPending: boolean;
  isError: boolean;
  emptyMessage: string;
  rows: readonly RowAction[];
}>) {
  if (isPending) {
    return (
      <div className="flex flex-col gap-3">
        {PLACEHOLDER_KEYS.map((key) => (
          <Skeleton key={key} variant="text" />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <Alert variant="danger">
        <span>
          This history could not be loaded, so nothing here says what happened. Try again.
        </span>
      </Alert>
    );
  }

  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyMessage}</p>;
  }

  return (
    <ul className="flex flex-col">
      {rows.map((row) => (
        <HistoryRow key={row.id} row={row} />
      ))}
    </ul>
  );
}

/**
 * Takes a feature and an entity id rather than a studentId, so a branch or exam
 * detail screen can reuse this unchanged.
 */
export function EntityHistory({
  feature,
  entityId,
  className,
}: Readonly<{ feature: AuditFeature; entityId: string; className?: string }>) {
  const history = useQuery({
    queryKey: ['admin', 'audit', 'row-actions', 'entity', feature, entityId],
    queryFn: () => api.admin.audit.rowActions({ feature, entityId, pageSize: HISTORY_LIMIT }),
  });

  const rows = history.data?.items ?? [];

  // The server scopes a normal admin to their own rows, so an unqualified "no activity" would
  // read as "nothing ever happened to this record" — which is what this card exists to avoid.
  const { identity } = useAuth();
  const mine = !(identity?.isSuperAdmin ?? false);

  return (
    <FormSection className={className} title="History">
      <div>
        <HistoryBody
          isPending={history.isPending}
          isError={history.isError}
          emptyMessage={
            mine
              ? `No activity of yours on this record in the last ${AUDIT_WINDOW_DAYS} days.`
              : `No activity in the last ${AUDIT_WINDOW_DAYS} days.`
          }
          rows={rows}
        />
      </div>
    </FormSection>
  );
}
