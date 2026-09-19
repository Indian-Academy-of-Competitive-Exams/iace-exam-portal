/// <reference types="nativewind/types" />
import { Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import {
  continueWith,
  newestFirst,
  openNow,
  sittablesOf,
  upNext,
  type Sittable,
} from '@iace/app-kit';
import {
  currentStreak,
  dispositionRates,
  instituteDayLabel,
  instituteWallTime,
  longestStreak,
  percentLabel,
  type PerformancePoint,
  type StudentOverview,
} from '@iace/contracts';
import { Text } from '../../src/components/ui/text';
import { api } from '../../src/lib/api';
import { TEST_DAYS_QUERY_KEY } from '../../src/lib/constants';
import { ACCOUNT_ROUTES, DETAIL_ROUTES, ROUTES } from '../../src/lib/nav';
import { catalogQuery, overviewQuery, performanceQuery } from '../../src/lib/queries';
import { Alert } from '../../src/components/ui/alert';
import { Button } from '../../src/components/ui/button';
import { Card } from '../../src/components/ui/card';
import { EmptyState, EMPTY_STATE_KINDS } from '../../src/components/ui/empty-state';
import { RefreshScroll } from '../../src/components/ui/refresh-scroll';
import { Skeleton } from '../../src/components/ui/skeleton';
import { StatTile, StatTileRow } from '../../src/components/ui/stat-tile';
import { ScoreTrend } from '../../src/components/performance/score-trend';
import { TestTile } from '../../src/components/tests/test-tile';
import { useAuth } from '../../src/providers/auth';

const DASH = '—';

/** How many sittings the landing screen looks back over before it sends them to Performance. */
const RECENT_RESULTS = 3;

/** The institute's clock, never the device's — a student abroad is still on an IST morning. */
const GREETINGS = [
  { until: 12, word: 'Good morning' },
  { until: 17, word: 'Good afternoon' },
  { until: 24, word: 'Good evening' },
] as const;

/** Where a student lands. A strict subset of Performance — the headline, and the way to the rest. */
export default function HomeScreen() {
  const { identity } = useAuth();
  const catalog = useQuery(catalogQuery);
  const overview = useQuery(overviewQuery);
  const trend = useQuery(performanceQuery);
  const testDays = useQuery({ queryKey: TEST_DAYS_QUERY_KEY, queryFn: () => api.me.testDays() });

  const now = new Date();
  const waiting = waitingOn(sittablesOf(catalog.data?.series ?? []));
  const recent = newestFirst(trend.data?.points ?? []).slice(0, RECENT_RESULTS);

  const refresh = () => {
    void catalog.refetch();
    void overview.refetch();
    void trend.refetch();
  };

  return (
    <RefreshScroll refreshing={catalog.isRefetching} onRefresh={refresh}>
      <Text variant="title">{greetingFor(now, identity?.fullName)}</Text>

      <PreTest ready={identity?.preTestReady ?? true} />

      <NextUp catalog={catalog} waiting={waiting} now={now} />

      {overview.data ? <Standing overview={overview.data} /> : null}

      {testDays.data ? (
        <StatTileRow>
          <StatTile label="Current streak" value={days(currentStreak(testDays.data.days))} />
          <StatTile label="Longest streak" value={days(longestStreak(testDays.data.days))} />
        </StatTileRow>
      ) : null}

      <ScoreTrend points={trend.data?.points ?? []} />

      <Recent recent={recent} />
    </RefreshScroll>
  );
}

/** The pre-test gate — mother's name, father's name, date of birth. A PROMPT, never a wall. */
function PreTest({ ready }: Readonly<{ ready: boolean }>) {
  const router = useRouter();
  if (ready) return null;

  return (
    <Alert variant="warning">
      Before your first test we need your mother&rsquo;s name, father&rsquo;s name and date of birth
      They go on your hall ticket.
      {'\n'}
      <Text className="font-medium" onPress={() => router.navigate(ACCOUNT_ROUTES.PROFILE)}>
        Add them
      </Text>
    </Alert>
  );
}

/** The one paper worth pointing at, and never nothing — an absent block explains itself. */
function NextUp({
  catalog,
  waiting,
  now,
}: Readonly<{
  catalog: { isLoading: boolean; isError: boolean; refetch: () => void };
  waiting: readonly Sittable[];
  now: Date;
}>) {
  const router = useRouter();

  if (catalog.isLoading) return <Skeleton className="h-40 rounded-xl" />;
  if (catalog.isError) {
    return (
      <EmptyState
        kind={EMPTY_STATE_KINDS.FAILURE}
        title="Your tests did not load"
        onRetry={catalog.refetch}
      />
    );
  }

  if (waiting.length === 0) {
    return (
      <EmptyState
        title="Nothing open"
        // ui-copy-ok: rule — a test opening is the branch's move, never the student's
        hint="Your branch opens the next one when it is ready."
        action={
          <Button variant="outline" size="sm" onPress={() => router.navigate(ROUTES.TESTS)}>
            Go to your tests
          </Button>
        }
      />
    );
  }

  return (
    <View className="gap-3">
      <Text variant="section">Up next</Text>
      {waiting.map((row) => (
        <TestTile key={row.test.id} row={row} now={now} fullWidth />
      ))}
    </View>
  );
}

/** The standing itself, always on screen once anything has been sat — a dash is an answer. */
function Standing({ overview }: Readonly<{ overview: StudentOverview }>) {
  if (overview.standing.testsAttempted === 0) return null;
  const rates = dispositionRates(overview.disposition);

  return (
    <StatTileRow>
      <StatTile label="Average percentile" value={overview.standing.avgPercentile ?? DASH} />
      <StatTile label="Best percentile" value={overview.standing.bestPercentile ?? DASH} />
      <StatTile label="Sittings" value={overview.standing.testsAttempted} />
      <StatTile label="Accuracy" value={percentLabel(rates.accuracy, DASH)} />
    </StatTileRow>
  );
}

/** The last few sittings, so a student who has finished everything still lands on something. */
function Recent({ recent }: Readonly<{ recent: readonly PerformancePoint[] }>) {
  const router = useRouter();
  if (recent.length === 0) return null;

  return (
    <View className="gap-3">
      <Text variant="section">Recent results</Text>
      <Card>
        {recent.map((point, index) => (
          <Pressable
            key={point.attemptId}
            accessibilityRole="button"
            onPress={() => router.navigate(DETAIL_ROUTES.REPORT(point.attemptId))}
            className={index > 0 ? 'gap-1 border-t border-border p-4' : 'gap-1 p-4'}
          >
            <Text variant="label" numberOfLines={1}>
              {point.testTitle ?? 'Untitled test'}
            </Text>
            <Text variant="meta">{resultLine(point)}</Text>
          </Pressable>
        ))}
      </Card>
    </View>
  );
}

/** One paper each, in the order a student would reach for them — never the same one twice. */
function waitingOn(rows: readonly Sittable[]): Sittable[] {
  const running = continueWith(rows);
  const open = openNow(rows).find((row) => row.test.id !== running?.test.id);
  return [running, open, upNext(rows)[0]].filter((row) => row !== undefined);
}

const resultLine = (point: PerformancePoint) =>
  [
    `${point.score} of ${point.maxMarks} marks`,
    point.percentile === null ? null : `${point.percentile}th percentile`,
    point.submittedAt === null ? null : `sat ${instituteDayLabel(point.submittedAt)}`,
  ]
    .filter((part) => part !== null)
    .join(' · ');

const days = (count: number) => (count === 1 ? '1 day' : `${count} days`);

function greetingFor(now: Date, name: string | null | undefined): string {
  const hour = Number(instituteWallTime(now).slice(11, 13));
  const word = (GREETINGS.find((band) => hour < band.until) ?? GREETINGS[2]).word;
  return name ? `${word}, ${name.trim().split(/\s+/)[0]}` : word;
}
