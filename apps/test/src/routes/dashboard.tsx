import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ClipboardList } from 'lucide-react';
import {
  Alert,
  Button,
  EmptyState,
  Metric,
  PageFrame,
  Skeleton,
  cn,
  linkVariants,
  plural,
} from '@iace/ui';
import { newestFirst } from '@iace/app-kit';
import {
  INSTITUTE_TIME_ZONE,
  instituteWallTime,
  type PerformancePoint,
  type StudentOverview,
} from '@iace/contracts';
import { PreTestPrompt } from '../components/pre-test-prompt';
import {
  DividedList,
  DividedRow,
  Hero,
  PageBody,
  Section,
  StatBand,
  SurfaceCard,
} from '../components/ui';
import { api } from '../lib/api';
import {
  CATALOG_QUERY_KEY,
  OVERVIEW_QUERY_KEY,
  PERFORMANCE_QUERY_KEY,
  ROUTES,
} from '../lib/constants';
import { continueWith, openNow, sittablesOf, upNext, type Sittable } from '../lib/catalog';
import { useAuth } from '../providers/auth';

const WHEN = new Intl.DateTimeFormat('en-IN', {
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

/** Where a student lands. A strict subset of Performance — the headline, and the way to the rest. */
export function DashboardPage() {
  const { identity: student } = useAuth();
  const overview = useQuery({ queryKey: OVERVIEW_QUERY_KEY, queryFn: () => api.me.overview() });
  const trend = useQuery({ queryKey: PERFORMANCE_QUERY_KEY, queryFn: () => api.me.performance() });
  const catalog = useQuery({ queryKey: CATALOG_QUERY_KEY, queryFn: () => api.me.catalog() });

  const now = new Date();
  const rows = sittablesOf(catalog.data?.series ?? [], now);
  const latest = newestFirst(trend.data?.points ?? [])[0];

  return (
    <PageFrame>
      <PageBody>
        <Hero
          title={greetingFor(now, student?.fullName)}
          aside={
            <Button asChild variant="outline">
              <Link to={ROUTES.PERFORMANCE}>See your performance</Link>
            </Button>
          }
        />

        <PreTestPrompt preTestReady={student?.preTestReady ?? true} />

        <NextUp catalog={catalog} rows={rows} now={now} />

        <Standing overview={overview} />

        <Section
          title="Continue"
          action={
            <Link className={linkVariants()} to={ROUTES.TESTS}>
              See all tests
            </Link>
          }
        >
          <ContinueRegion catalog={catalog} rows={rows} latest={latest} now={now} />
        </Section>
      </PageBody>
    </PageFrame>
  );
}

/** The one paper worth pointing at before anything else on the screen. */
function NextUp({
  catalog,
  rows,
  now,
}: Readonly<{ catalog: QueryState; rows: readonly Sittable[]; now: Date }>) {
  if (catalog.isLoading) return <Skeleton variant="row" className="h-28 rounded-xl" />;
  if (catalog.isError) return <Alert variant="danger">Your tests did not load.</Alert>;

  const row = continueWith(rows) ?? openNow(rows)[0] ?? upNext(rows)[0];
  if (!row) return null;

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

function Standing({ overview }: Readonly<{ overview: OverviewQuery }>) {
  if (overview.isLoading) return <Skeleton variant="row" className="h-24 rounded-xl" />;
  if (overview.isError) return <Alert variant="danger">Your performance did not load.</Alert>;

  const standing = overview.data?.standing;
  if (!standing || standing.testsAttempted === 0) return null;

  return (
    <StatBand>
      <Metric label="Average percentile" value={standing.avgPercentile ?? '—'} size="sm" />
      <Metric label="Best percentile" value={standing.bestPercentile ?? '—'} size="sm" />
      <Metric label="Tests taken" value={standing.testsAttempted} size="sm" />
    </StatBand>
  );
}

/** The catalog's own load state, distinct from a genuinely empty one — an error is not "nothing". */
function ContinueRegion({
  catalog,
  rows,
  latest,
  now,
}: Readonly<{
  catalog: QueryState;
  rows: readonly Sittable[];
  latest: PerformancePoint | undefined;
  now: Date;
}>) {
  if (catalog.isLoading) return <Skeleton variant="row" className="h-40 rounded-xl" />;
  if (catalog.isError) return <Alert variant="danger">Your tests did not load.</Alert>;

  const running = continueWith(rows);
  const open = openNow(rows).filter((row) => row.test.id !== running?.test.id);
  const next = upNext(rows);
  const nothing = !running && open.length === 0 && next.length === 0 && latest === undefined;

  if (nothing) {
    return (
      <EmptyState
        icon={ClipboardList}
        title="Nothing waiting"
        action={
          <Button asChild>
            <Link to={ROUTES.TESTS}>Go to your tests</Link>
          </Button>
        }
      />
    );
  }

  return (
    <DividedList>
      {[running, open[0], next[0]]
        .filter((row) => row !== undefined)
        .map((row) => (
          <DividedRow
            key={row.test.id}
            lead={<LaneLabel lane={laneOf(row)} />}
            title={row.test.title ?? 'Untitled test'}
            meta={papersLine(row, now)}
            action={<TestExit row={row} small />}
          />
        ))}
      {latest ? (
        <DividedRow
          lead={<LaneLabel lane="Result ready" />}
          title={latest.testTitle ?? 'Untitled test'}
          meta={resultLine(latest)}
          action={
            <Button asChild size="sm" variant="outline">
              <Link to={ROUTES.REPORT(latest.attemptId)}>View report</Link>
            </Button>
          }
        />
      ) : null}
    </DividedList>
  );
}

/** The row's state, in the word the exam world uses for it, coloured by what it means. */
const LANE_TONE = {
  'In progress': 'text-warning-ink',
  'Open now': 'text-primary-ink',
  'Up next': 'text-muted-foreground',
  'Result ready': 'text-success-ink',
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
  ]
    .filter((part) => part !== null)
    .join(' · ');

function whenLine(row: Sittable, now: Date): string | null {
  const { opensAt, closesAt } = row.test;
  if (opensAt !== null && Date.parse(opensAt) > now.getTime()) {
    return `opens ${WHEN.format(new Date(opensAt))}`;
  }
  return closesAt === null ? null : `closes ${WHEN.format(new Date(closesAt))}`;
}

function greetingFor(now: Date, name: string | null | undefined): string {
  const hour = Number(instituteWallTime(now).slice(11, 13));
  const word = (GREETINGS.find((band) => hour < band.until) ?? GREETINGS[2]).word;
  return name ? `${word}, ${name}` : word;
}

interface QueryState {
  isLoading: boolean;
  isError: boolean;
}

interface OverviewQuery extends QueryState {
  data: StudentOverview | undefined;
}
