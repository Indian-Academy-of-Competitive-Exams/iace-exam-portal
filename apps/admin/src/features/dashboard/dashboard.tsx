import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import {
  DIFFICULTY_LEVEL,
  FEATURE_KEYS,
  QUESTION_STATUSES,
  TEST_STATUSES,
  clockText,
  instituteDayLabel,
  type AssignmentRole,
  type AssignmentSummary,
  type AssignmentSummaryRow,
  type Dashboard,
  type DashboardBank,
  type DashboardCoverage,
  type DashboardHeadline,
  type DashboardSitting,
  type DashboardWindow,
  type DashboardWindows,
  type RowAction,
  instituteDateTimeLabel,
} from '@iace/contracts';
import {
  Badge,
  Card,
  ChartFigure,
  EmptyState,
  EMPTY_STATE_KINDS,
  LinePlot,
  MeasureBars,
  Metric,
  MetricGroup,
  PageFrame,
  PageHeader,
  SectionHeading,
  Skeleton,
  TruncatedText,
  cn,
  linkVariants,
  plural,
} from '@iace/ui';
import { api } from '../../lib/api';
import { ACTION_BADGE_VARIANT } from '../../lib/audit-vocabulary';
import { opensLabel } from '../../lib/duration';
import {
  AUDIT_ACTION_LABELS,
  AUDIT_ACTOR_TYPE_LABELS,
  AUDIT_FEATURE_LABELS,
  QUERY_KEYS,
  QUESTION_STATUS_LABELS,
  ROUTES,
  TEST_STATUS_LABELS,
} from '../../lib/constants';
import { useAuth } from '../../providers/auth';
import { DueStandingBadge } from '../../components/due-standing-badge';
import { TimeSpent } from '../../components/time-spent';

const UNTITLED = 'Untitled test';

/** The one admin screen that is a composed grid: five bands, each present only if its key is. */
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
      <DashboardBody
        data={dashboard.data}
        isError={dashboard.isError}
        onRetry={dashboard.refetch}
      />
    </PageFrame>
  );
}

/** Loaded, failed, or still coming — in that order, so an outage never reads as a slow load. */
function DashboardBody({
  data,
  isError,
  onRetry,
}: Readonly<{ data: Dashboard | undefined; isError: boolean; onRetry: () => void }>) {
  if (data) return <Bands data={data} />;
  if (isError) {
    return (
      <EmptyState
        kind={EMPTY_STATE_KINDS.FAILURE}
        title="Could not load your dashboard"
        onRetry={onRetry}
      />
    );
  }
  return <DashboardSkeleton />;
}

function Bands({ data }: Readonly<{ data: Dashboard }>) {
  return (
    <div className="flex flex-col gap-6 pb-4">
      {data.work ? <WorkCard work={data.work} /> : null}
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
              value={questions[status] ?? 0}
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
  const { can } = useAuth();
  const drawn = bank.coverage.filter((subject) => subject.active > 0);
  const ceiling = Math.max(...drawn.map((subject) => subject.active), 1);

  return (
    <ChartFigure
      className="lg:col-span-2"
      title="Coverage"
      meta={plural(drawn.length, 'subject')}
      figure={
        bank.openAssignments === undefined ? null : (
          <Metric
            size="md"
            label="Open assignments"
            // The band also reaches a bank or typing admin, who has no reader's queue to follow it to.
            value={
              can(FEATURE_KEYS.QUESTION_PROOFREAD) ? (
                <Link to={ROUTES.PROOFREADING_ASSIGNMENTS} className={linkVariants()}>
                  {bank.openAssignments}
                </Link>
              ) : (
                bank.openAssignments
              )
            }
          />
        )
      }
    >
      {drawn.length === 0 ? (
        <EmptyState level={3} title="No live questions yet" />
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
  const ranked = sittings.reduce((sum, sitting) => sum + sitting.evaluated, 0);
  const ceiling = Math.max(...sittings.map((sitting) => sitting.evaluated), 1);

  return (
    <ChartFigure
      className="lg:col-span-2"
      title="Sittings"
      meta={plural(sittings.length, 'test')}
      figure={<Metric size="md" label="Ranked sittings" value={ranked} />}
    >
      {ranked === 0 ? (
        <EmptyState level={3} title="Nothing sat yet" />
      ) : (
        <LinePlot
          compact
          points={sittings.map((sitting) => ({
            key: sitting.testId,
            label: sitting.title ?? UNTITLED,
            value: sitting.evaluated,
            caption: opensLabel(sitting.opensAt),
          }))}
          max={ceiling}
          aria-label="Ranked sittings per live test, oldest first"
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
          <Link
            to={ROUTES.AUDIT}
            className={cn(linkVariants(), 'inline-flex items-center gap-1 [&_svg]:size-4')}
          >
            All
            <ChevronRight aria-hidden />
          </Link>
        }
      />
      {feed.length === 0 ? (
        <EmptyState level={3} title="No changes yet" />
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
                {instituteDateTimeLabel(row.createdAt)}
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
      {bare ? <EmptyState level={3} title="No open or upcoming tests" /> : null}
      <WindowList title="Open" rows={windows.open} />
      <WindowList title="Upcoming" rows={windows.upcoming} />
    </Card>
  );
}

function WindowList({
  title,
  rows,
}: Readonly<{ title: string; rows: readonly DashboardWindow[] }>) {
  // A branch-access admin sees the windows without the tests behind them, so for them a title is text.
  const opensTests = useAuth().can(FEATURE_KEYS.TEST_MANAGEMENT);
  if (rows.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      <SectionHeading level={3} title={title} meta={String(rows.length)} />
      <ul className="flex flex-col gap-2">
        {rows.map((row) => (
          <li key={row.testId} className="flex min-w-0 flex-col gap-0.5 text-sm">
            {opensTests ? (
              <Link to={ROUTES.TEST(row.testId)} className={linkVariants()}>
                <TruncatedText>{row.title ?? UNTITLED}</TruncatedText>
              </Link>
            ) : (
              <TruncatedText>{row.title ?? UNTITLED}</TruncatedText>
            )}
            <span className="text-xs text-muted-foreground">
              {`${row.series} · ${opensLabel(row.opensAt)}`}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// --------------------------------------------------------------------------- Band E — own sections
// ---------------------------------------------------------------------------

/** What each role's work is called here, its own queue, and the page one of its sections opens on. */
const ROLE_WORK: Readonly<
  Record<
    AssignmentRole,
    { title: string; queue: string; section: (testId: string, sectionId: string) => string }
  >
> = {
  TYPIST: { title: 'Typing', queue: ROUTES.AUTHORING_ASSIGNMENTS, section: ROUTES.TYPING_SECTION },
  PROOFREADER: {
    title: 'Proof-reading',
    queue: ROUTES.PROOFREADING_ASSIGNMENTS,
    section: ROUTES.READING_SECTION,
  },
};

function WorkCard({ work }: Readonly<{ work: AssignmentSummary }>) {
  return (
    <Card className="grid items-start gap-4 p-4 lg:grid-cols-3">
      <div className="flex min-w-0 flex-col gap-4 lg:col-span-2">
        <SectionHeading title="My sections" />
        {work.roles.map((role) => (
          <div key={role.role} className="flex flex-col gap-3">
            <SectionHeading
              level={3}
              title={ROLE_WORK[role.role].title}
              action={
                <Link
                  to={ROLE_WORK[role.role].queue}
                  className={cn(linkVariants(), 'inline-flex items-center gap-1 [&_svg]:size-4')}
                >
                  All
                  <ChevronRight aria-hidden />
                </Link>
              }
            />
            <MetricGroup className="sm:gap-0 sm:[&>*]:px-4">
              <Metric size="md" label="Assigned" value={role.assigned} />
              <Metric size="md" label="Completed" value={role.completed} />
              <Metric size="md" label="On time" value={role.onTime} />
              <Metric size="md" label="Overdue" value={role.overdue} />
              <Metric size="md" label="Time spent" value={clockText(role.secondsSpent)} />
            </MetricGroup>
          </div>
        ))}
      </div>
      <div className="flex min-w-0 flex-col gap-2">
        <SectionHeading level={3} title="Due next" meta={String(work.next.length)} />
        {work.next.length === 0 ? (
          <EmptyState level={3} size="sm" title="Nothing owed" />
        ) : (
          <ul className="flex flex-col gap-2">
            {work.next.map((row) => (
              <OwedSection key={row.assignmentId} row={row} />
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

function OwedSection({ row }: Readonly<{ row: AssignmentSummaryRow }>) {
  return (
    <li className="flex min-w-0 flex-col gap-0.5 text-sm">
      <Link
        to={ROLE_WORK[row.role].section(row.testId, row.baseConfigSectionId)}
        className={linkVariants()}
      >
        <TruncatedText>{`${row.sectionName} · ${row.testTitle ?? UNTITLED}`}</TruncatedText>
      </Link>
      <span className="flex items-center gap-2 text-xs text-muted-foreground">
        {row.dueAt ? `Due ${instituteDayLabel(row.dueAt)}` : 'No due date'}
        <DueStandingBadge standing={row.standing} />
        <TimeSpent seconds={row.secondsSpent} />
      </span>
    </li>
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
