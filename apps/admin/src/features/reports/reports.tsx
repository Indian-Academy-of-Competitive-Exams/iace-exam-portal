import { Link } from 'react-router-dom';
import {
  FEATURE_KEYS,
  REPORTS,
  REPORT_GROUPS,
  type ReportGroup,
  type ReportKey,
  type ReportSpec,
} from '@iace/contracts';
import { PageCrumbs, useFilters } from '@iace/app-kit/browser';
import {
  EMPTY_STATE_KINDS,
  BadgeList,
  DataTable,
  EmptyState,
  PageFrame,
  PageHeader,
  TableFrame,
  TruncatedText,
  linkVariants,
  type DataTableColumn,
} from '@iace/ui';
import { NAV_ITEMS, REPORT_GROUP_LABELS, REPORT_PARAM_LABELS, ROUTES } from '../../lib/constants';
import { useAuth } from '../../providers/auth';

interface CatalogueRow extends ReportSpec {
  key: ReportKey;
}

const CATALOGUE: readonly CatalogueRow[] = (Object.keys(REPORTS) as ReportKey[]).map((key) => ({
  key,
  ...(REPORTS[key] satisfies ReportSpec),
}));

const GROUPS: readonly ReportGroup[] = Object.values(REPORT_GROUPS);

const COLUMNS: DataTableColumn<CatalogueRow>[] = [
  {
    key: 'title',
    header: 'Report',
    className: 'max-w-[24rem]',
    cell: (row) => (
      <Link to={ROUTES.REPORT(row.key)} className={linkVariants()}>
        <TruncatedText>{row.title}</TruncatedText>
      </Link>
    ),
  },
  {
    key: 'needs',
    header: 'Asked for by',
    cell: (row) => (
      <BadgeList
        items={row.needs.map((param) => REPORT_PARAM_LABELS[param])}
        label={(needed) => needed}
        max={3}
      />
    ),
  },
];

export function ReportsPage() {
  const { can, identity } = useAuth();
  const filters = useFilters<'group'>();
  const open = GROUPS.find((group) => group === filters.get('group')) ?? GROUPS[0];

  if (!can(FEATURE_KEYS.REPORTS) || open === undefined) {
    return (
      <PageFrame>
        <EmptyState kind={EMPTY_STATE_KINDS.REFUSED} title="Reports are not open to you" />
      </PageFrame>
    );
  }

  // A report only a super admin may open is left out for everyone else, not shown and refused.
  const offered = CATALOGUE.filter((row) => !row.superAdminOnly || identity?.isSuperAdmin);

  return (
    <TableFrame
      header={<PageHeader breadcrumbs={<PageCrumbs nav={NAV_ITEMS} />} title="Reports" />}
      tabs={{
        value: open,
        onValueChange: (group) => filters.set({ group }),
        items: GROUPS.map((group) => ({
          value: group,
          label: REPORT_GROUP_LABELS[group],
          content: (
            <DataTable
              columns={COLUMNS}
              rows={offered.filter((row) => row.group === group)}
              rowKey={(row) => row.key}
              isLoading={false}
              empty="No reports"
            />
          ),
        })),
      }}
    />
  );
}
