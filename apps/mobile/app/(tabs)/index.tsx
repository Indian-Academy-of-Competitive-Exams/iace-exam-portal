/// <reference types="nativewind/types" />
import { Pressable, View } from 'react-native';
import ClipboardList from 'lucide-react-native/icons/clipboard-list';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import {
  greetingFor,
  newestFirst,
  resultLine,
  sittablesOf,
  waitingOn,
  type Sittable,
  laneOf,
  papersLine,
} from '@iace/app-kit';
import {
  currentStreak,
  dispositionRates,
  longestStreak,
  percentLabel,
  RECENT_STANDINGS,
  type PerformancePoint,
  type StudentOverview,
} from '@iace/contracts';
import { Text } from '../../src/components/ui/text';
import { api } from '../../src/lib/api';
import { TEST_DAYS_QUERY_KEY } from '../../src/lib/constants';
import { ACCOUNT_ROUTES, DETAIL_ROUTES, ROUTES } from '../../src/lib/nav';
import { catalogQuery, overviewQuery, performanceQuery } from '../../src/lib/queries';
import { Button } from '../../src/components/ui/button';
import { Card } from '../../src/components/ui/card';
import { EmptyState, EMPTY_STATE_KINDS } from '../../src/components/ui/empty-state';
import { RefreshScroll } from '../../src/components/ui/refresh-scroll';
import { Skeleton } from '../../src/components/ui/skeleton';
import { StatTile, StatTileRow } from '../../src/components/ui/stat-tile';
import { ScoreTrend } from '../../src/components/performance/score-trend';
import { Alert } from '../../src/components/ui/alert';
import { cn } from '../../src/lib/cn';
import { useAuth } from '../../src/providers/auth';
import { useRefetchOnFocus } from '../../src/lib/use-refetch-on-focus';

const DASH = '—';

/** How many sittings the landing screen looks back over before it sends them to Performance. */
const RECENT_RESULTS = 3;

/** Where a student lands. A strict subset of Performance — the headline, and the way to the rest. */
export default function HomeScreen() {
  useRefetchOnFocus();
  const { identity } = useAuth();
  const router = useRouter();
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
      <Button variant="outline" onPress={() => router.navigate(ROUTES.PERFORMANCE)}>
        See your performance
      </Button>

      <PreTest ready={identity?.preTestReady ?? true} />

      <NextUp catalog={catalog} waiting={waiting} now={now} />

      <Standing overview={overview} />

      {testDays.data ? (
        <StatTileRow>
          <StatTile label="Current streak" value={days(currentStreak(testDays.data.days))} />
          <StatTile label="Longest streak" value={days(longestStreak(testDays.data.days))} />
        </StatTileRow>
      ) : null}

      <Trend trend={trend} />

      {waiting.length > 1 ? <AlsoWaiting waiting={waiting.slice(1)} now={now} /> : null}

      <Recent trend={trend} recent={recent} />
    </RefreshScroll>
  );
}

/** The pre-test gate — mother's name, father's name, date of birth. A PROMPT, never a wall. */
function PreTest({ ready }: Readonly<{ ready: boolean }>) {
  const router = useRouter();
  if (ready) return null;

  return (
    <Alert
      variant="warning"
      icon={ClipboardList}
      action={
        <Button size="sm" onPress={() => router.navigate(ACCOUNT_ROUTES.PROFILE)}>
          Add them
        </Button>
      }
    >
      <Text className="font-medium text-warning-ink">Before your first test.</Text> We need your
      mother&rsquo;s name, father&rsquo;s name and date of birth. They go on your hall ticket. It
      takes a minute.
    </Alert>
  );
}

/** The one paper worth pointing at, and never nothing — an absent block explains itself. */
function NextUp({
  catalog,
  waiting,
  now,
}: Readonly<{
  catalog: { isLoading: boolean; isLoadingError: boolean; refetch: () => void };
  waiting: readonly Sittable[];
  now: Date;
}>) {
  const router = useRouter();

  if (catalog.isLoading) return <Skeleton className="h-40 rounded-xl" />;
  if (catalog.isLoadingError) {
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

  const row = waiting[0];

  return (
    <Card className="gap-3 p-4">
      <View className="gap-1">
        <LaneLabel lane={laneOf(row)} />
        <Text numberOfLines={2} className="text-lg font-semibold tracking-tight text-foreground">
          {row.test.title ?? 'Untitled test'}
        </Text>
        <Text variant="meta">{papersLine(row, now)}</Text>
      </View>
      <TestExit row={row} />
    </Card>
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
    <Text className={cn('text-xs font-semibold uppercase tracking-wide', LANE_TONE[lane])}>
      {lane}
    </Text>
  );
}

/** Sit it or reopen it; a scheduled paper has nothing to press yet and says so on its own row. */
function TestExit({ row, small }: Readonly<{ row: Sittable; small?: boolean }>) {
  const router = useRouter();
  if (row.action === null) return null;

  return (
    <Button
      size={small ? 'sm' : 'default'}
      variant={row.action === 'RESUME' ? 'warning' : 'default'}
      onPress={() => router.push(DETAIL_ROUTES.TEST(row.test.id))}
    >
      {row.action === 'RESUME' ? 'Resume' : 'Start test'}
    </Button>
  );
}

function AlsoWaiting({ waiting, now }: Readonly<{ waiting: readonly Sittable[]; now: Date }>) {
  const router = useRouter();

  return (
    <View className="gap-3">
      <View className="flex-row items-center justify-between gap-3">
        <Text variant="section">Also waiting</Text>
        <Button variant="ghost" size="sm" onPress={() => router.navigate(ROUTES.TESTS)}>
          See all tests
        </Button>
      </View>
      <Card>
        {waiting.map((row, index) => (
          <View
            key={row.test.id}
            className={cn('gap-3 p-4', index > 0 && 'border-t border-border')}
          >
            <View className="gap-1">
              <LaneLabel lane={laneOf(row)} />
              <Text variant="label" numberOfLines={1}>
                {row.test.title ?? 'Untitled test'}
              </Text>
              <Text variant="meta">{papersLine(row, now)}</Text>
            </View>
            <TestExit row={row} small />
          </View>
        ))}
      </Card>
    </View>
  );
}

/** The standing itself, always on screen once anything has been sat — a dash is an answer. */
function Standing({
  overview,
}: Readonly<{
  overview: {
    data: StudentOverview | undefined;
    isLoading: boolean;
    isLoadingError: boolean;
    refetch: () => void;
  };
}>) {
  if (overview.isLoading) return <Skeleton className="h-24 rounded-xl" />;
  if (overview.isLoadingError) {
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
    <StatTileRow>
      <StatTile
        label={`Average percentile (last ${RECENT_STANDINGS})`}
        value={standing.avgPercentile ?? DASH}
      />
      <StatTile
        label={`Best percentile (last ${RECENT_STANDINGS})`}
        value={standing.bestPercentile ?? DASH}
      />
      <StatTile label="Average score" value={standing.avgScore ?? DASH} />
      <StatTile label="Sittings" value={standing.testsAttempted} />
      <StatTile label="Accuracy" value={percentLabel(rates.accuracy, DASH)} />
      <StatTile label="Attempted" value={percentLabel(rates.attemptRate, DASH)} />
    </StatTileRow>
  );
}

interface TrendQuery {
  data: { points: PerformancePoint[] } | undefined;
  isLoading: boolean;
  isLoadingError: boolean;
  refetch: () => void;
}

function Trend({ trend }: Readonly<{ trend: TrendQuery }>) {
  if (trend.isLoading) return <Skeleton className="h-48 rounded-xl" />;
  if (trend.isLoadingError) {
    return (
      <EmptyState
        kind={EMPTY_STATE_KINDS.FAILURE}
        title="Your results did not load"
        onRetry={trend.refetch}
      />
    );
  }
  return <ScoreTrend points={trend.data?.points ?? []} />;
}

/** The last few sittings, so a student who has finished everything still lands on something. */
function Recent({
  trend,
  recent,
}: Readonly<{ trend: TrendQuery; recent: readonly PerformancePoint[] }>) {
  const router = useRouter();
  if (trend.isLoading) return <Skeleton className="h-40 rounded-xl" />;
  if (trend.isLoadingError || recent.length === 0) return null;

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

const days = (count: number) => (count === 1 ? '1 day' : `${count} days`);
