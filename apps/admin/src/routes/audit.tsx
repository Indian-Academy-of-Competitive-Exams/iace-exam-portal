import { useMemo, useState } from 'react';
import {
  AUDIT_WINDOW_DAYS,
  PAGE_SIZE_MAX,
  auditActionSchema,
  auditFeatureSchema,
  type AuditAction,
  type AuditFeature,
  type ImportLogSummary,
  type RowAction,
} from '@iace/contracts';
import {
  Alert,
  Badge,
  Combobox,
  DataTable,
  PageHeader,
  Pagination,
  Select,
  TableFrame,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  type DataTableColumn,
} from '@iace/ui';
import { useInfinitePages, useListQuery } from '@iace/app-kit';
import { ACTION_BADGE_VARIANT, ChangedCell, WHEN_FORMATTER } from '../lib/audit-format';
import { api } from '../lib/api';
import {
  AUDIT_ACTION_LABELS,
  AUDIT_ACTOR_TYPE_LABELS,
  AUDIT_FEATURE_LABELS,
  AUDIT_TAB,
  IMPORT_SOURCE_LABELS,
  type AuditTabValue,
} from '../lib/constants';
import { useFilters } from '../lib/use-filters';
import { useAuth } from '../providers/auth';

/** The Activity tab's own filters — what the empty-state wording and the filter count read. */
const ROW_ACTION_FILTERS = ['feature', 'action', 'actorId'] as const;
type FilterKey = (typeof ROW_ACTION_FILTERS)[number] | 'tab' | 'run';

/** Mirrors `apps/api`'s `IMPORT_LOG_STATUS` — the contract leaves `status` a plain string on purpose. */
const IMPORT_STATUS_LABELS: Readonly<Record<string, string>> = {
  PREVIEWED: 'Previewed',
  COMMITTED: 'Committed',
  FAILED: 'Failed',
};
const IMPORT_STATUS_VARIANT: Readonly<Record<string, 'neutral' | 'success' | 'danger'>> = {
  PREVIEWED: 'neutral',
  COMMITTED: 'success',
  FAILED: 'danger',
};

/** Built outside the component: `cell` is a render prop, not a component declaration. */
function auditColumns(): DataTableColumn<RowAction>[] {
  return [
    {
      key: 'when',
      header: 'When',
      cell: (row) => WHEN_FORMATTER.format(new Date(row.createdAt)),
    },
    {
      key: 'who',
      header: 'Who',
      // A script or the archive job has no name — its actor type is the closest thing to one.
      cell: (row) => row.actorName ?? AUDIT_ACTOR_TYPE_LABELS[row.actorType],
    },
    {
      key: 'feature',
      header: 'Feature',
      cell: (row) => <Badge variant="neutral">{AUDIT_FEATURE_LABELS[row.feature]}</Badge>,
    },
    {
      key: 'action',
      header: 'Action',
      cell: (row) => (
        <Badge variant={ACTION_BADGE_VARIANT[row.action]}>{AUDIT_ACTION_LABELS[row.action]}</Badge>
      ),
    },
    {
      key: 'entity',
      header: 'Entity',
      cell: (row) => (
        <span className="font-mono text-xs text-muted-foreground">{row.entityId}</span>
      ),
    },
    { key: 'changed', header: 'Changed', cell: (row) => <ChangedCell row={row} /> },
  ];
}

/** Built outside the component for the same reason `auditColumns` is — `highlightId` is its one input. */
function importColumns(highlightId: string): DataTableColumn<ImportLogSummary>[] {
  return [
    {
      key: 'started',
      header: 'Started',
      cell: (row) => (
        <span className="flex items-center gap-2">
          {WHEN_FORMATTER.format(new Date(row.startedAt))}
          {row.id === highlightId ? <Badge variant="primary">This run</Badge> : null}
        </span>
      ),
    },
    {
      key: 'who',
      header: 'Who',
      cell: (row) => row.actorName ?? IMPORT_SOURCE_LABELS[row.source],
    },
    {
      key: 'feature',
      header: 'Feature',
      cell: (row) => <Badge variant="neutral">{AUDIT_FEATURE_LABELS[row.feature]}</Badge>,
    },
    {
      key: 'source',
      header: 'Source',
      cell: (row) => IMPORT_SOURCE_LABELS[row.source],
    },
    {
      key: 'status',
      header: 'Status',
      cell: (row) => (
        <Badge variant={IMPORT_STATUS_VARIANT[row.status] ?? 'neutral'}>
          {IMPORT_STATUS_LABELS[row.status] ?? row.status}
        </Badge>
      ),
    },
    {
      key: 'counts',
      header: 'Rows',
      cell: (row) => (
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
          <span>{row.total} total</span>
          <span>{row.created} created</span>
          <span>{row.updated} updated</span>
          <span>{row.skipped} skipped</span>
          <span className={row.failed > 0 ? 'font-medium text-destructive' : undefined}>
            {row.failed} failed
          </span>
        </div>
      ),
    },
  ];
}

export function AuditPage() {
  const { identity } = useAuth();
  const isSuperAdmin = identity?.isSuperAdmin ?? false;
  const filters = useFilters<FilterKey>();

  const tab = (filters.get('tab') || AUDIT_TAB.ACTIVITY) as AuditTabValue;
  const highlightRunId = filters.get('run');

  const feature = filters.get('feature');
  const action = filters.get('action');
  const actorId = filters.get('actorId');

  /** Every admin, a page at a time, searched server-side. The server ignores this filter for
   *  anyone but a super admin, so it is fetched — and shown — only for one. */
  const [actorSearch, setActorSearch] = useState('');
  const actorPages = useInfinitePages({
    queryKey: ['admin', 'admins', 'filter', actorSearch],
    fetchPage: (page) => api.admin.admins.list({ page, pageSize: PAGE_SIZE_MAX, q: actorSearch }),
    enabled: isSuperAdmin && tab === AUDIT_TAB.ACTIVITY,
  });

  const rowActionQuery = {
    feature: (feature || undefined) as AuditFeature | undefined,
    action: (action || undefined) as AuditAction | undefined,
    actorId: isSuperAdmin ? actorId || undefined : undefined,
  };

  // Each tab fetches only while it's the one on screen — switching tabs doesn't
  // run both queries in the background.
  const activity = useListQuery({
    queryKey: ['admin', 'audit', 'row-actions'],
    filters: rowActionQuery,
    fetchPage: (params) => api.admin.audit.rowActions(params),
    enabled: tab === AUDIT_TAB.ACTIVITY,
  });

  const imports = useListQuery({
    queryKey: ['admin', 'audit', 'imports'],
    filters: {},
    fetchPage: (params) => api.admin.audit.imports(params),
    enabled: tab === AUDIT_TAB.IMPORTS,
  });

  const activityColumns = useMemo(() => auditColumns(), []);
  const importsColumns = useMemo(() => importColumns(highlightRunId), [highlightRunId]);

  // The chosen admin is often outside the loaded combobox pages; the loaded
  // rows already carry their name, and that is the one place left to find it.
  const selectedActorLabel =
    activity.items.find((row) => row.actorId === actorId)?.actorName ?? undefined;

  const activityToolbar = (
    <>
      <Alert variant="info" className="mb-4">
        <span>
          Showing the last {AUDIT_WINDOW_DAYS} days. Older activity is archived to storage and is
          not shown here.
        </span>
      </Alert>

      <div className="mb-3 flex flex-wrap gap-3">
        <div className="w-48">
          <Select
            aria-label="Filter by feature"
            value={feature}
            onChange={(event) => filters.set({ feature: event.target.value })}
          >
            <option value="">All features</option>
            {auditFeatureSchema.options.map((value) => (
              <option key={value} value={value}>
                {AUDIT_FEATURE_LABELS[value]}
              </option>
            ))}
          </Select>
        </div>

        <div className="w-44">
          <Select
            aria-label="Filter by action"
            value={action}
            onChange={(event) => filters.set({ action: event.target.value })}
          >
            <option value="">All actions</option>
            {auditActionSchema.options.map((value) => (
              <option key={value} value={value}>
                {AUDIT_ACTION_LABELS[value]}
              </option>
            ))}
          </Select>
        </div>

        {isSuperAdmin ? (
          <div className="w-56">
            <Combobox
              aria-label="Filter by actor"
              value={actorId}
              onChange={(next) => filters.set({ actorId: next })}
              selectedLabel={selectedActorLabel}
              items={actorPages.items.map((admin) => ({
                value: admin.id,
                label: admin.fullName ?? admin.email,
                hint: admin.fullName ? admin.email : undefined,
              }))}
              placeholder="Any admin"
              search={actorSearch}
              onSearchChange={setActorSearch}
              searchPlaceholder="Search admins"
              hasMore={actorPages.hasMore}
              onLoadMore={actorPages.loadMore}
              isLoading={actorPages.isLoading}
              isLoadingMore={actorPages.isLoadingMore}
              emptyLabel="No admin matches that"
            />
          </div>
        ) : null}
      </div>
    </>
  );

  return (
    <Tabs
      value={tab}
      onValueChange={(value) => filters.set({ tab: value, run: '' })}
      className="flex min-h-0 flex-1 flex-col"
    >
      <div className="shrink-0">
        <PageHeader
          title="Audit log"
          description="Every create, update, status change and import run across the platform."
        />

        <TabsList className="mb-4">
          <TabsTrigger value={AUDIT_TAB.ACTIVITY}>Activity</TabsTrigger>
          <TabsTrigger value={AUDIT_TAB.IMPORTS}>Imports</TabsTrigger>
        </TabsList>
      </div>

      <TabsContent value={AUDIT_TAB.ACTIVITY} className="flex min-h-0 flex-1 flex-col p-0">
        <TableFrame toolbar={activityToolbar}>
          <DataTable
            columns={activityColumns}
            rows={activity.items}
            rowKey={(row) => row.id}
            isLoading={activity.isLoading}
            empty={
              filters.activeCount(ROW_ACTION_FILTERS) > 0
                ? `No activity matches those filters in the last ${AUDIT_WINDOW_DAYS} days.`
                : `No activity in the last ${AUDIT_WINDOW_DAYS} days.`
            }
            footer={activity.hasLoaded ? <Pagination {...activity.pagination} /> : null}
          />
        </TableFrame>
      </TabsContent>

      <TabsContent value={AUDIT_TAB.IMPORTS} className="flex min-h-0 flex-1 flex-col p-0">
        <TableFrame>
          <DataTable
            columns={importsColumns}
            rows={imports.items}
            rowKey={(row) => row.id}
            isLoading={imports.isLoading}
            empty="No import runs yet."
            footer={imports.hasLoaded ? <Pagination {...imports.pagination} /> : null}
          />
        </TableFrame>
      </TabsContent>
    </Tabs>
  );
}
