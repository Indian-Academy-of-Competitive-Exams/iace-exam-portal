import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  EmptyState,
  EMPTY_STATE_KINDS,
  Alert,
  Button,
  ChartFigure,
  LinePlot,
  Metric,
  PageFrame,
  PageHeader,
  Skeleton,
  cn,
  linkVariants,
  plural,
  type LinePoint,
  type PlotBand,
  type PlotReference,
} from '@iace/ui';
import { newestFirst } from '@iace/app-kit';
import { PageCrumbs, StreakFigure } from '@iace/app-kit/browser';
import {
  INSTITUTE_TIME_ZONE,
  dispositionRates,
  instituteWallTime,
  percentLabel,
  type PerformancePoint,
  type StudentOverview,
} from '@iace/contracts';
import { PreTestPrompt } from '../components/pre-test-prompt';
import {
  DividedList,
  DividedRow,
  PageBody,
  Section,
  StatBand,
  SurfaceCard,
} from '../components/ui';
import { api } from '../lib/api';
import {
  CATALOG_QUERY_KEY,
  NAV_ITEMS,
  OVERVIEW_QUERY_KEY,
  PERFORMANCE_QUERY_KEY,
  ROUTES,
  TEST_DAYS_QUERY_KEY,
} from '../lib/constants';
import { continueWith, openNow, sittablesOf, upNext, type Sittable } from '../lib/catalog';
import { useAuth } from '../providers/auth';

const WHEN = new Intl.DateTimeFormat('en-IN', {
  timeZone: INSTITUTE_TIME_ZONE,
  dateStyle: 'medium',
});

const WHEN_EXACT = new Intl.DateTimeFormat('en-IN', {
  timeZone: INSTITUTE_TIME_ZONE,
  dateStyle: 'medium',
  timeStyle: 'short',
});

/** The institute's clock, never the device's — a student abroad is still on an IST morning. */
const GREETINGS = [
  { until: 12, word: 'Good morning' },
  { until: 17, word: 'Good afternoon' },
  { until: 24, word: 'Good evening' },
] as const;

/** How many sittings the landing screen looks back over before it sends them to Performance. */
const RECENT_RESULTS = 3;

/** viewBox units against the wide box a full-width plot uses, not pixels. */
const TREND_HEIGHT = 190;

/** Drawn so a low line reads as a low SCORE rather than as a plot that failed to render. */
const TREND_TICKS = [0, 25, 50, 75, 100];

/** Where a percentile stops being a middle and starts being a placing worth chasing. */
const TOP_QUARTER: PlotBand = { from: 75, to: 100, label: 'Top quarter' };

/** Where a student lands. A strict subset of Performance — the headline, and the way to the rest. */
export function DashboardPage() {
  const { identity: student } = useAuth();
  const overview = useQuery({ queryKey: OVERVIEW_QUERY_KEY, queryFn: () => api.me.overview() });
  const trend = useQuery({ queryKey: PERFORMANCE_QUERY_KEY, queryFn: () => api.me.performance() });
  const catalog = useQuery({ queryKey: CATALOG_QUERY_KEY, queryFn: () => api.me.catalog() });
  const testDays = useQuery({
    queryKey: TEST_DAYS_QUERY_KEY,
    queryFn: () => api.me.testDays(),
  });

  const now = new Date();
  const waiting = waitingOn(sittablesOf(catalog.data?.series ?? []));
  const recent = newestFirst(trend.data?.points ?? []).slice(0, RECENT_RESULTS);

  return (
    <PageFrame
      header={
        <PageHeader
          breadcrumbs={<PageCrumbs nav={NAV_ITEMS} />}
          size="display"
          title={greetingFor(now, student?.fullName)}
          action={
            <Button asChild variant="outline">
              <Link to={ROUTES.PERFORMANCE}>See your performance</Link>
            </Button>
          }
        />
      }
    >
      <PageBody>
        <PreTestPrompt preTestReady={student?.preTestReady ?? true} />

        <NextUp catalog={catalog} waiting={waiting} now={now} />

        <Standing overview={overview} />

        <div className="grid items-start gap-4 xl:grid-cols-3">
          <div className="min-w-0 xl:col-span-2">
            <Trend trend={trend} points={trend.data?.points ?? []} />
          </div>
          {testDays.data ? <StreakFigure calendar={testDays.data} /> : null}
        </div>

        {waiting.length > 1 ? (
          <Section
            title="Also waiting"
            action={
              <Link className={linkVariants()} to={ROUTES.TESTS}>
                See all tests
              </Link>
            }
          >
            <DividedList>
              {waiting.slice(1).map((row) => (
                <DividedRow
                  key={row.test.id}
                  lead={<LaneLabel lane={laneOf(row)} />}
                  title={row.test.title ?? 'Untitled test'}
                  meta={papersLine(row, now)}
                  action={<TestExit row={row} small />}
                />
              ))}
            </DividedList>
          </Section>
        ) : null}

        <RecentResults trend={trend} recent={recent} />
      </PageBody>
    </PageFrame>
  );
}

/** The one paper worth pointing at, and never nothing — an absent block explains itself. */
function NextUp({
  catalog,
  waiting,
  now,
}: Readonly<{ catalog: QueryState; waiting: readonly Sittable[]; now: Date }>) {
  if (catalog.isLoading) return <Skeleton variant="row" className="h-28 rounded-xl" />;
  if (catalog.isError) {
    return (
      <EmptyState
        kind={EMPTY_STATE_KINDS.FAILURE}
        title="Your tests did not load"
        onRetry={catalog.refetch}
      />
    );
  }

  const row = waiting[0];
  if (!row) {
    return (
      <EmptyState
        title="Nothing open"
        /* ui-copy-ok: rule */
        hint="Your branch opens the next one when it is ready."
        action={
          <Button asChild size="sm" variant="outline">
            <Link to={ROUTES.TESTS}>Go to your tests</Link>
          </Button>
        }
      />
    );
  }

  return (
    <SurfaceCard>
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-4">
        <div className="flex min-w-0 flex-col gap-1">
          <LaneLabel lane={laneOf(row)} />
          <span className="truncate text-lg font-semibold tracking-tight text-foreground">
            {row.test.title ?? 'Untitled test'}
          </span>
          <span className="text-sm text-muted-foreground">{papersLine(row, now)}</span>
        </div>
        <TestExit row={row} />
      </div>
    </SurfaceCard>
  );
}

/** The standing itself, always on screen — a dash is an answer, and the Alert below says why. */
function Standing({ overview }: Readonly<{ overview: OverviewQuery }>) {
  if (overview.isLoading) return <Skeleton variant="row" className="h-24 rounded-xl" />;
  if (overview.isError) {
    return (
      <EmptyState
        kind={EMPTY_STATE_KINDS.FAILURE}
        title="Your performance did not load"
        onRetry={overview.refetch}
      />
    );
  }

  const data = overview.data;
  if (!data || data.standing.testsAttempted === 0) return null;

  const { standing, disposition } = data;
  const rates = dispositionRates(disposition);

  return (
    <>
      {standing.testsEvaluated === 0 ? (
        /* ui-copy-ok: consequence */
        <Alert variant="info">
          No ranked test of yours has been marked yet, so there is no percentile or score to stand
          on.
        </Alert>
      ) : null}

      <StatBand>
        <Metric label="Average percentile" value={standing.avgPercentile ?? '—'} size="sm" />
        <Metric label="Best percentile" value={standing.bestPercentile ?? '—'} size="sm" />
        <Metric label="Average score" value={standing.avgScore ?? '—'} size="sm" />
        <Metric label="Sittings" value={standing.testsAttempted} size="sm" />
        <Metric label="Accuracy" value={percentLabel(rates.accuracy, '—')} size="sm" />
        <Metric label="Attempted" value={percentLabel(rates.attemptRate, '—')} size="sm" />
      </StatBand>
    </>
  );
}

/** The line a student came to see. It plots the percentile once one exists, and the marks until. */
function Trend({
  trend,
  points,
}: Readonly<{ trend: QueryState; points: readonly PerformancePoint[] }>) {
  if (trend.isLoading) return <Skeleton variant="row" className="h-48 rounded-xl" />;
  if (trend.isError) return null;

  const line = trendOf(points);
  if (line === null) return null;

  return (
    <ChartFigure title={line.title} meta={plural(points.length, 'sitting')}>
      <LinePlot
        points={line.points}
        ticks={TREND_TICKS}
        band={line.band}
        reference={line.reference}
        suffix={line.suffix}
        height={TREND_HEIGHT}
        aria-label={line.title}
      />
    </ChartFigure>
  );
}

interface Trendline {
  title: string;
  suffix: string;
  points: LinePoint[];
  band?: PlotBand;
  reference?: PlotReference;
}

/** A percentile needs a marked ranked sitting; until there is one the same line reads the marks. */
function trendOf(points: readonly PerformancePoint[]): Trendline | null {
  if (points.length === 0) return null;
  const ranked = points.some((point) => point.percentile !== null);

  const plotted = points.map((point) => ({
    key: point.attemptId,
    label: point.testTitle ?? 'Untitled test',
    value: ranked ? point.percentile : point.percentage,
    caption: `${point.score} of ${point.maxMarks} marks`,
  }));

  const mean = average(plotted.map((point) => point.value));

  return {
    title: ranked ? 'Percentile' : 'Score',
    suffix: ranked ? '' : '%',
    points: plotted,
    band: ranked ? TOP_QUARTER : undefined,
    reference: mean === null ? undefined : { value: mean, label: 'Your average', tone: 'neutral' },
  };
}

/** Null-safe because an unranked sitting has no percentile, and a mean of nothing is not zero. */
function average(values: readonly (number | null)[]): number | null {
  const held = values.filter((value) => value !== null);
  if (held.length === 0) return null;
  return Math.round(held.reduce((sum, value) => sum + value, 0) / held.length);
}

/** The last few sittings, so a student who has finished everything still lands on something. */
function RecentResults({
  trend,
  recent,
}: Readonly<{ trend: QueryState; recent: readonly PerformancePoint[] }>) {
  if (trend.isLoading) return <Skeleton variant="row" className="h-40 rounded-xl" />;
  if (trend.isError) {
    return (
      <EmptyState
        kind={EMPTY_STATE_KINDS.FAILURE}
        title="Your results did not load"
        onRetry={trend.refetch}
      />
    );
  }
  if (recent.length === 0) return null;

  return (
    <Section
      title="Recent results"
      action={
        <Link className={linkVariants()} to={ROUTES.PERFORMANCE}>
          See your performance
        </Link>
      }
    >
      <DividedList>
        {recent.map((point) => (
          <DividedRow
            key={point.attemptId}
            title={point.testTitle ?? 'Untitled test'}
            meta={resultLine(point)}
            action={
              <Button asChild size="sm" variant="outline">
                <Link to={ROUTES.REPORT(point.attemptId)}>View report</Link>
              </Button>
            }
          />
        ))}
      </DividedList>
    </Section>
  );
}

/** The row's state, in the word the exam world uses for it, coloured by what it means. */
const LANE_TONE = {
  'In progress': 'text-warning-ink',
  'Open now': 'text-primary-ink',
  'Up next': 'text-muted-foreground',
} as const;

type Lane = keyof typeof LANE_TONE;

function LaneLabel({ lane }: Readonly<{ lane: Lane }>) {
  return (
    <span className={cn('text-xs font-semibold uppercase tracking-wide', LANE_TONE[lane])}>
      {lane}
    </span>
  );
}

/** Sit it or reopen it; a scheduled paper has nothing to press yet and says so on its own row. */
function TestExit({ row, small }: Readonly<{ row: Sittable; small?: boolean }>) {
  if (row.action === null) return null;

  return (
    <Button asChild size={small ? 'sm' : 'default'}>
      <Link to={ROUTES.TEST_INSTRUCTIONS(row.test.id)}>
        {row.action === 'RESUME' ? 'Resume' : 'Start test'}
      </Link>
    </Button>
  );
}

/** One paper each, in the order a student would reach for them — never the same one twice. */
function waitingOn(rows: readonly Sittable[]): Sittable[] {
  const running = continueWith(rows);
  const open = openNow(rows).find((row) => row.test.id !== running?.test.id);
  return [running, open, upNext(rows)[0]].filter((row) => row !== undefined);
}

const laneOf = (row: Sittable): Lane => {
  if (row.action === 'RESUME') return 'In progress';
  return row.action === 'START' ? 'Open now' : 'Up next';
};

const papersLine = (row: Sittable, now: Date) =>
  [
    row.seriesName,
    `${plural(row.test.totalQuestions, 'question')} · ${Math.round(row.test.durationSec / 60)} minutes`,
    whenLine(row, now),
  ]
    .filter((part) => part !== null)
    .join(' · ');

const resultLine = (point: PerformancePoint) =>
  [
    `${point.score} of ${point.maxMarks} marks`,
    point.percentile === null ? null : `${point.percentile}th percentile`,
    point.rank === null ? null : `rank ${point.rank}`,
    point.submittedAt === null ? null : `sat ${WHEN.format(new Date(point.submittedAt))}`,
  ]
    .filter((part) => part !== null)
    .join(' · ');

function whenLine(row: Sittable, now: Date): string | null {
  const { opensAt } = row.test;
  if (opensAt === null || Date.parse(opensAt) <= now.getTime()) return null;

  return `opens ${WHEN_EXACT.format(new Date(opensAt))}`;
}

function greetingFor(now: Date, name: string | null | undefined): string {
  const hour = Number(instituteWallTime(now).slice(11, 13));
  const word = (GREETINGS.find((band) => hour < band.until) ?? GREETINGS[2]).word;
  return name ? `${word}, ${name}` : word;
}

interface QueryState {
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
}

interface OverviewQuery extends QueryState {
  data: StudentOverview | undefined;
}
