import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { BookOpen, CalendarClock, History } from 'lucide-react';
import {
  DIFFICULTY_LEVEL,
  QUESTION_STATUS,
  QUESTION_STATUSES,
  TEST_STATUSES,
  type Dashboard,
  type DashboardBank,
  type DashboardCoverage,
  type DashboardHeadline,
  type DashboardSitting,
  type DashboardWindow,
  type DashboardWindows,
  type RowAction,
} from '@iace/contracts';
import {
  Badge,
  Card,
  ChartFigure,
  EmptyState,
  LinePlot,
  MeasureBars,
  Metric,
  MetricGroup,
  PageFrame,
  PageHeader,
  SectionHeading,
  Skeleton,
  TruncatedText,
  linkVariants,
} from '@iace/ui';
import { api } from '../lib/api';
import { ACTION_BADGE_VARIANT, WHEN_FORMATTER } from '../lib/audit-vocabulary';
import { opensLabel } from '../lib/schedule-format';
import {
  AUDIT_ACTION_LABELS,
  AUDIT_ACTOR_TYPE_LABELS,
  AUDIT_FEATURE_LABELS,
  QUERY_KEYS,
  QUESTION_STATUS_LABELS,
  ROUTES,
  TEST_STATUS_LABELS,
} from '../lib/constants';
import { useAuth } from '../providers/auth';

const UNTITLED = 'Untitled test';

/** The one admin screen that is a composed grid: four bands, each present only if its key is. */
export function DashboardPage() {
  const { identity: admin } = useAuth();
  const dashboard = useQuery({
    queryKey: QUERY_KEYS.DASHBOARD,
    queryFn: () => api.admin.dashboard.get(),
  });

  const header = (
    <PageHeader size="display" title={admin?.fullName ? `Welcome, ${admin.fullName}` : 'Welcome'} />
  );

  return (
    <PageFrame header={header}>
      {dashboard.data ? <Bands data={dashboard.data} /> : <DashboardSkeleton />}
    </PageFrame>
  );
}

function Bands({ data }: Readonly<{ data: Dashboard }>) {
  return (
    <div className="flex flex-col gap-6 pb-4">
      {data.headline ? <Headline headline={data.headline} /> : null}
      <div className="grid items-start gap-4 lg:grid-cols-3">
        {data.bank ? <BankFigure bank={data.bank} /> : null}
        {data.windows ? <WindowsCard windows={data.windows} /> : null}
        {data.activity?.sittings ? <SittingsFigure sittings={data.activity.sittings} /> : null}
        {data.activity ? <ActivityCard feed={data.activity.feed} /> : null}
      </div>
    </div>
  );
}

// --------------------------------------------------------------------------- Band A — headline
// ---------------------------------------------------------------------------

function Headline({ headline }: Readonly<{ headline: DashboardHeadline }>) {
  const { students, catalog, questions, tests } = headline;

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {students ? (
        <Tile title="Students">
          <Metric size="md" label="Total" value={students.total} />
          <Metric size="md" label="Active" value={students.active} />
          <Metric size="md" label="Suspended" value={students.suspended} />
        </Tile>
      ) : null}

      {questions ? (
        <Tile title="Question bank">
          {QUESTION_STATUSES.map((status) => (
            <Metric
              key={status}
              size="md"
              label={QUESTION_STATUS_LABELS[status]}
              value={
                status === QUESTION_STATUS.DRAFT ? (
                  <Link to={ROUTES.QUESTION_APPROVALS} className={linkVariants()}>
                    {questions[status] ?? 0}
                  </Link>
                ) : (
                  (questions[status] ?? 0)
                )
              }
            />
          ))}
        </Tile>
      ) : null}

      {tests ? (
        <Tile title="Tests" meta={`${tests.series} series`}>
          {TEST_STATUSES.map((status) => (
            <Metric
              key={status}
              size="md"
              label={TEST_STATUS_LABELS[status]}
              value={tests.byStatus[status] ?? 0}
            />
          ))}
        </Tile>
      ) : null}

      {catalog ? (
        <Tile title="Catalog">
          <Metric size="md" label="Branches" value={catalog.branches} />
          <Metric size="md" label="Programs" value={catalog.programs} />
          <Metric size="md" label="Exams" value={catalog.exams} />
        </Tile>
      ) : null}
    </div>
  );
}

/** Siblings of one kind, which is the boundary a card earns here. */
function Tile({
  title,
  meta,
  children,
}: Readonly<{ title: string; meta?: string; children: React.ReactNode }>) {
  return (
    <Card className="flex flex-col gap-3 p-4">
      <SectionHeading level={3} title={title} meta={meta} />
      <MetricGroup className="sm:gap-0 sm:[&>*]:px-4">{children}</MetricGroup>
    </Card>
  );
}

// --------------------------------------------------------------------------- Band B — bank health
// ---------------------------------------------------------------------------

function BankFigure({ bank }: Readonly<{ bank: DashboardBank }>) {
  const drawn = bank.coverage.filter((subject) => subject.active > 0);
  const ceiling = Math.max(...drawn.map((subject) => subject.active), 1);

  return (
    <ChartFigure
      className="lg:col-span-2"
      title="Coverage"
      meta={`${drawn.length} subjects`}
      figure={
        bank.openFlags === undefined ? null : (
          <Metric size="md" label="Open flags" value={bank.openFlags} />
        )
      }
    >
      {drawn.length === 0 ? (
        <EmptyState level={3} icon={BookOpen} title="No live questions yet" />
      ) : (
        <MeasureBars bars={drawn.map(coverageBar)} max={ceiling} />
      )}
    </ChartFigure>
  );
}

/** The hard count rides alongside the total: a subject deep in easy questions is still thin. */
function coverageBar(subject: DashboardCoverage) {
  const hard = subject.byDifficulty[DIFFICULTY_LEVEL.HIGH] ?? 0;
  return {
    key: subject.subjectId,
    label: subject.subject,
    value: subject.active,
    display: String(subject.active),
    meta: `${hard} hard`,
  };
}

// --------------------------------------------------------------------------- Band C — activity
// ---------------------------------------------------------------------------

function SittingsFigure({ sittings }: Readonly<{ sittings: readonly DashboardSitting[] }>) {
  const attempts = sittings.reduce((sum, sitting) => sum + sitting.attempts, 0);
  const ceiling = Math.max(...sittings.map((sitting) => sitting.attempts), 1);

  return (
    <ChartFigure
      className="lg:col-span-2"
      title="Sittings"
      meta={`${sittings.length} tests`}
      figure={<Metric size="md" label="Attempts" value={attempts} />}
    >
      {attempts === 0 ? (
        <EmptyState level={3} icon={CalendarClock} title="Nothing sat yet" />
      ) : (
        <LinePlot
          compact
          points={sittings.map((sitting) => ({
            key: sitting.testId,
            label: sitting.title ?? UNTITLED,
            value: sitting.attempts,
            caption: opensLabel(sitting.opensAt),
          }))}
          max={ceiling}
          aria-label="Attempts per live test, oldest first"
        />
      )}
    </ChartFigure>
  );
}

function ActivityCard({ feed }: Readonly<{ feed: readonly RowAction[] }>) {
  return (
    <Card className="flex flex-col gap-3 p-4">
      <SectionHeading
        title="Activity"
        action={
          <Link to={ROUTES.AUDIT} className={linkVariants()}>
            All
          </Link>
        }
      />
      {feed.length === 0 ? (
        <EmptyState level={3} icon={History} title="No changes yet" />
      ) : (
        <ul className="flex flex-col gap-2">
          {feed.map((row) => (
            <li key={row.id} className="flex min-w-0 items-baseline gap-2 text-sm">
              <Badge variant={ACTION_BADGE_VARIANT[row.action]}>
                {AUDIT_ACTION_LABELS[row.action]}
              </Badge>
              <TruncatedText className="min-w-0 flex-1">
                {`${AUDIT_FEATURE_LABELS[row.feature]} · ${row.actorName ?? AUDIT_ACTOR_TYPE_LABELS[row.actorType]}`}
              </TruncatedText>
              <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                {WHEN_FORMATTER.format(new Date(row.createdAt))}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// --------------------------------------------------------------------------- Band D — windows
// ---------------------------------------------------------------------------

function WindowsCard({ windows }: Readonly<{ windows: DashboardWindows }>) {
  const bare = windows.open.length === 0 && windows.upcoming.length === 0;

  return (
    <Card className="flex flex-col gap-4 p-4">
      <SectionHeading title="Windows" />
      {bare ? (
        <EmptyState level={3} icon={CalendarClock} title="No open or upcoming tests" />
      ) : null}
      <WindowList title="Open" rows={windows.open} />
      <WindowList title="Upcoming" rows={windows.upcoming} />
    </Card>
  );
}

function WindowList({
  title,
  rows,
}: Readonly<{ title: string; rows: readonly DashboardWindow[] }>) {
  if (rows.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      <SectionHeading level={3} title={title} meta={String(rows.length)} />
      <ul className="flex flex-col gap-2">
        {rows.map((row) => (
          <li key={row.testId} className="flex min-w-0 flex-col gap-0.5 text-sm">
            <Link to={ROUTES.TEST(row.testId)} className={linkVariants()}>
              <TruncatedText>{row.title ?? UNTITLED}</TruncatedText>
            </Link>
            <span className="text-xs text-muted-foreground">
              {`${row.series} · ${opensLabel(row.opensAt)}`}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// --------------------------------------------------------------------------- Loading
// ---------------------------------------------------------------------------

const TILE_KEYS = ['a', 'b', 'c', 'd'] as const;

function DashboardSkeleton() {
  return (
    <div className="flex flex-col gap-6 pb-4">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {TILE_KEYS.map((key) => (
          <Skeleton key={key} variant="kpi" />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Skeleton className="h-64 rounded-xl lg:col-span-2" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    </div>
  );
}
