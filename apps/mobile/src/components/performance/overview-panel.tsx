/// <reference types="nativewind/types" />
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { minutes, newestFirst, sittingHint } from '@iace/app-kit';
import {
  dispositionRates,
  effortPerSitting,
  instituteDayLabel,
  percentLabel,
  rankSubjectsByWeakness,
  scopesSat,
  standingTiles,
  TEST_SCOPE_LABELS,
  type PerformancePoint,
  type StudentOverview,
  type TestScope,
} from '@iace/contracts';
import { DETAIL_ROUTES, ROUTES } from '../../lib/nav';
import { overviewQuery, performanceQuery } from '../../lib/queries';
import { plural } from '../../lib/plural';
import { Button } from '../ui/button';
import { Card } from '../ui/card';
import { ChipRow, type ChipOption } from '../ui/chip-row';
import { EmptyState, EMPTY_STATE_KINDS } from '../ui/empty-state';
import { MeasureBars, type MeasureBar } from '../ui/measure-bars';
import { RefreshScroll } from '../ui/refresh-scroll';
import { Skeleton } from '../ui/skeleton';
import { StatTile } from '../ui/stat-tile';

const DASH = '—';
const EVERY_SCOPE = '';

/** Their whole career off the rollups: where they stand, which subjects cost them, what they sat. */
export function OverviewPanel() {
  const overview = useQuery(overviewQuery);
  const trend = useQuery(performanceQuery);

  const refresh = () => {
    void overview.refetch();
    void trend.refetch();
  };

  return (
    <RefreshScroll refreshing={overview.isRefetching} onRefresh={refresh}>
      {overview.isLoading ? <OverviewSkeleton /> : null}
      {overview.isError ? (
        <EmptyState
          kind={EMPTY_STATE_KINDS.FAILURE}
          title="Your performance did not load"
          onRetry={refresh}
        />
      ) : null}
      {overview.data ? <Body overview={overview.data} sittings={trend.data?.points ?? []} /> : null}
    </RefreshScroll>
  );
}

function Body({
  overview,
  sittings,
}: Readonly<{ overview: StudentOverview; sittings: readonly PerformancePoint[] }>) {
  const router = useRouter();
  const [scope, setScope] = useState(EVERY_SCOPE);
  const scopes = scopesSat(overview.subjects);
  const chosen = scopes.includes(scope as TestScope) ? (scope as TestScope) : null;

  if (overview.standing.testsAttempted === 0) {
    return (
      <EmptyState
        title="No tests sat yet"
        action={<Button onPress={() => router.navigate(ROUTES.TESTS)}>Go to your tests</Button>}
      />
    );
  }

  return (
    <>
      <Standing overview={overview} />

      <View className="flex-row flex-wrap gap-3">
        {standingTiles(overview.standing).map((tile) => (
          <StatTile key={tile.key} label={tile.label} value={tile.value ?? DASH} />
        ))}
      </View>

      {scopes.length > 1 ? (
        <ChipRow
          scroll
          label="Scope"
          options={scopeOptions(scopes)}
          value={scope}
          onChange={setScope}
        />
      ) : null}

      <Subjects overview={overview} scope={chosen} />
      <Effort overview={overview} />
      <Sittings sittings={sittings} />
    </>
  );
}

/** The standing is a percentile, so until a sitting is marked there is nothing to lead with. */
function Standing({ overview }: Readonly<{ overview: StudentOverview }>) {
  const { avgPercentile, bestPercentile, lastAttemptAt } = overview.standing;
  if (overview.standing.testsEvaluated === 0) return null;

  return (
    <Card className="gap-1 p-5">
      <Text className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Average percentile
      </Text>
      <View className="flex-row items-baseline gap-1">
        <Text className="text-3xl font-bold tracking-tight text-foreground">
          {avgPercentile ?? DASH}
        </Text>
        {avgPercentile === null ? null : (
          <Text className="text-lg font-semibold text-muted-foreground">th</Text>
        )}
      </View>
      <Text className="text-sm text-muted-foreground">
        {bestPercentile === null ? 'nothing marked yet' : `best ${bestPercentile}`}
      </Text>
      {lastAttemptAt === null ? null : (
        <Text className="text-xs text-muted-foreground">
          {`Last sat ${instituteDayLabel(lastAttemptAt)}`}
        </Text>
      )}
    </Card>
  );
}

/** Weakest first, and never branded off five questions — the thin ones are named, not ranked. */
function Subjects({
  overview,
  scope,
}: Readonly<{ overview: StudentOverview; scope: TestScope | null }>) {
  const ranked = rankSubjectsByWeakness(overview.subjects, scope);
  if (ranked.weakest.length === 0 && ranked.thin.length === 0) return null;

  const bars: MeasureBar[] = ranked.weakest.map((row) => ({
    key: row.subjectId,
    label: row.name,
    value: row.measure.accuracy ?? 0,
    display: percentLabel(row.measure.accuracy, DASH),
    meta: plural(row.measure.attempted, 'answered', 'answered'),
    tone: 2,
  }));

  return (
    <View className="gap-3">
      <Text className="text-lg font-semibold text-foreground">Subjects</Text>
      <Card className="gap-3 p-5">
        {bars.length > 0 ? <MeasureBars bars={bars} max={100} /> : null}
        {ranked.thin.length > 0 ? (
          <Text className="text-xs text-muted-foreground">
            {`Too few answered to rank: ${ranked.thin.map((row) => row.name).join(', ')}`}
          </Text>
        ) : null}
      </Card>
    </View>
  );
}

/** What every sitting added up to, and what one of them costs on average. */
function Effort({ overview }: Readonly<{ overview: StudentOverview }>) {
  const rates = dispositionRates(overview.disposition);
  const effort = effortPerSitting(overview.standing, overview.disposition);
  const bars: MeasureBar[] = [
    { key: 'correct', label: 'Correct', value: overview.disposition.correct, tone: 2 },
    { key: 'wrong', label: 'Wrong', value: overview.disposition.wrong, tone: 3 },
    { key: 'left', label: 'Unattempted', value: overview.disposition.unattempted },
  ];

  return (
    <View className="gap-3">
      <Text className="text-lg font-semibold text-foreground">Every question served</Text>
      <Card className="p-5">
        <MeasureBars bars={bars} max={rates.served} />
      </Card>
      <View className="flex-row flex-wrap gap-3">
        <StatTile label="Attempted" value={percentLabel(rates.attemptRate, DASH)} />
        <StatTile label="Accuracy" value={percentLabel(rates.accuracy, DASH)} />
        <StatTile label="Questions a sitting" value={effort.questions ?? DASH} />
        <StatTile label="Time a sitting" value={minutes(effort.timeSec)} />
      </View>
    </View>
  );
}

/** Every sitting they can still open, newest first — the way to any report from here. */
function Sittings({ sittings }: Readonly<{ sittings: readonly PerformancePoint[] }>) {
  const router = useRouter();
  const rows = newestFirst(sittings);
  if (rows.length === 0) return null;

  return (
    <View className="gap-3">
      <Text className="text-lg font-semibold text-foreground">Tests you have sat</Text>
      <Card>
        {rows.map((point, index) => (
          <Pressable
            key={point.attemptId}
            accessibilityRole="button"
            onPress={() => router.navigate(DETAIL_ROUTES.REPORT(point.attemptId))}
            className={index > 0 ? 'gap-1 border-t border-border p-4' : 'gap-1 p-4'}
          >
            <Text className="text-sm font-medium text-foreground" numberOfLines={1}>
              {point.testTitle ?? 'Untitled test'}
            </Text>
            <Text className="text-xs text-muted-foreground">
              {`${point.score} of ${point.maxMarks} marks · ${sittingHint(point)}`}
            </Text>
          </Pressable>
        ))}
      </Card>
    </View>
  );
}

const scopeOptions = (scopes: readonly TestScope[]): ChipOption[] => [
  { value: EVERY_SCOPE, label: 'Every scope' },
  ...scopes.map((scope) => ({ value: scope, label: TEST_SCOPE_LABELS[scope] })),
];

function OverviewSkeleton() {
  return (
    <View className="gap-4">
      <Skeleton className="h-28 rounded-xl" />
      <Skeleton className="h-24 rounded-xl" />
      <Skeleton className="h-48 rounded-xl" />
    </View>
  );
}
