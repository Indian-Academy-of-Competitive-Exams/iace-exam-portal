import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import {
  FEATURE_KEYS,
  REPORTS,
  REPORT_GROUPS,
  REPORT_PARAMS,
  type ReportGroup,
  type ReportKey,
  type ReportParam,
  type ReportSpec,
} from '@iace/contracts';
import { PageCrumbs, useFilterSpec } from '@iace/app-kit/browser';
import {
  EMPTY_STATE_KINDS,
  Badge,
  BadgeList,
  Card,
  EmptyState,
  PageFrame,
  PageHeader,
  SectionHeading,
  StatRow,
  plural,
  type ListFilter,
} from '@iace/ui';
import {
  NAV_ITEMS,
  REPORT_GROUP_LABELS,
  REPORT_PARAM_LABELS,
  REPORT_PERIOD_LABELS,
  REPORT_SUMMARIES,
  ROUTES,
} from '../../lib/constants';
import { useAuth } from '../../providers/auth';

interface CatalogueRow extends ReportSpec {
  key: ReportKey;
}

const CATALOGUE: readonly CatalogueRow[] = (Object.keys(REPORTS) as ReportKey[]).map((key) => ({
  key,
  ...(REPORTS[key] satisfies ReportSpec),
}));

const GROUPS: readonly ReportGroup[] = Object.values(REPORT_GROUPS);

const FILTERS = [
  { key: 'q', kind: 'search', label: 'Search', placeholder: 'Search reports', primary: true },
  {
    key: 'group',
    kind: 'choice',
    label: 'Group',
    primary: true,
    items: [
      { value: '', label: 'Any group' },
      ...GROUPS.map((group) => ({ value: group, label: REPORT_GROUP_LABELS[group] })),
    ],
  },
] as const satisfies readonly ListFilter[];

const NOTHING = <span className="text-muted-foreground">Nothing</span>;

/** The catalogue is written with a curly apostrophe and a keyboard types a straight one. */
const folded = (text: string): string => text.toLowerCase().replaceAll('’', "'");

export function ReportsPage() {
  const { can, identity } = useAuth();
  const filters = useFilterSpec(FILTERS);

  if (!can(FEATURE_KEYS.REPORTS)) {
    return (
      <PageFrame>
        <EmptyState kind={EMPTY_STATE_KINDS.REFUSED} title="Reports are not open to you" />
      </PageFrame>
    );
  }

  const sought = folded(filters.values.q.trim());
  // A report only a super admin may open is left out for everyone else, not shown and refused.
  const offered = CATALOGUE.filter((row) => !row.superAdminOnly || identity?.isSuperAdmin)
    .filter((row) => filters.values.group === '' || row.group === filters.values.group)
    .filter((row) => folded(`${row.title} ${REPORT_SUMMARIES[row.key]}`).includes(sought));
  const shelves = GROUPS.map((group) => ({
    group,
    rows: offered.filter((row) => row.group === group),
  })).filter(({ rows }) => rows.length > 0);

  return (
    <PageFrame
      header={
        <PageHeader
          breadcrumbs={<PageCrumbs nav={NAV_ITEMS} />}
          title="Reports"
          meta={plural(offered.length, 'report')}
        />
      }
      // A search and one choice: nothing for an any-or-all toggle to combine.
      filters={{
        spec: FILTERS,
        state: {
          values: filters.values,
          setFilter: filters.setFilter,
          clearFilters: filters.clearFilters,
        },
      }}
      filtersBesideTitle
    >
      {shelves.length === 0 ? (
        <EmptyState kind={EMPTY_STATE_KINDS.FILTERED} title="No report matches" />
      ) : (
        <div className="flex flex-col gap-8">
          {shelves.map(({ group, rows }) => (
            <section key={group} className="flex flex-col gap-3">
              <SectionHeading
                title={REPORT_GROUP_LABELS[group]}
                meta={plural(rows.length, 'report')}
              />
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                {rows.map((row) => (
                  <ReportCard key={row.key} row={row} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </PageFrame>
  );
}

function Asks({ params }: Readonly<{ params: readonly ReportParam[] }>) {
  return (
    <BadgeList
      items={params.map((param) => REPORT_PARAM_LABELS[param])}
      label={(asked) => asked}
      max={3}
      empty={NOTHING}
      className="justify-end"
    />
  );
}

/** One report among its siblings: what it holds, what it must be given, and what may narrow it. */
function ReportCard({ row }: Readonly<{ row: CatalogueRow }>) {
  const opensOn = row.needs.includes(REPORT_PARAMS.PERIOD) ? row.period : undefined;

  return (
    <Link
      to={ROUTES.REPORT(row.key)}
      className="group rounded-xl focus-visible:shadow-focus focus-visible:outline-none"
    >
      <Card className="flex h-full flex-col gap-3 p-4 transition-[box-shadow,border-color] group-hover:border-ring group-hover:shadow-md">
        <div className="flex items-start justify-between gap-2">
          <span className="text-md font-semibold tracking-tight text-foreground">{row.title}</span>
          <ChevronRight aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        </div>
        <p className="text-sm text-muted-foreground">{REPORT_SUMMARIES[row.key]}</p>
        <div className="mt-auto flex flex-col gap-1.5">
          <StatRow label="Needs" value={<Asks params={row.needs} />} />
          <StatRow label="Optional" value={<Asks params={row.takes ?? []} />} />
          {opensOn ? <StatRow label="Opens on" value={REPORT_PERIOD_LABELS[opensOn]} /> : null}
        </div>
        {row.superAdminOnly ? (
          <Badge variant="warning" className="self-start">
            Super admin only
          </Badge>
        ) : null}
      </Card>
    </Link>
  );
}
