/**
 * One series and its tests — ported from the web's `series.tsx`. Pushed outside `(tabs)`, so the
 * native stack's own back button is the way out; there is no breadcrumb to build. `PageCrumbs` and
 * a `DataTable` are web-only, so this reuses the same `TestTile` the Tests tab already shelves.
 */
import { Fragment } from 'react';
import { FlatList, View } from 'react-native';
import { Link, Stack, useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import {
  averageAccuracy,
  bestRank,
  resultsByTest,
  seriesProgress,
  sittablesOf,
  type SeriesProgress,
  type Sittable,
  type TestResult,
} from '@iace/app-kit';
import { type PerformancePoint, type StudentCatalogSeries } from '@iace/contracts';
import { Text } from '../../src/components/ui/text';
import { catalogQuery, performanceQuery } from '../../src/lib/queries';
import { Alert } from '../../src/components/ui/alert';
import { Button } from '../../src/components/ui/button';
import { Card } from '../../src/components/ui/card';
import { EmptyState, EMPTY_STATE_KINDS } from '../../src/components/ui/empty-state';
import { Skeleton } from '../../src/components/ui/skeleton';
import { TestTile } from '../../src/components/tests/test-tile';
import { ROUTES } from '../../src/lib/nav';
import { plural } from '../../src/lib/plural';

const CONTENT_STYLE = { paddingHorizontal: 20, paddingTop: 24, paddingBottom: 32, gap: 12 };

type Phase = 'LOADING' | 'ERROR' | 'REFUSED' | 'READY';

function phaseOf(
  catalog: { isLoading: boolean; isError: boolean },
  series: StudentCatalogSeries | undefined,
): Phase {
  if (catalog.isLoading) return 'LOADING';
  if (catalog.isError) return 'ERROR';
  return series ? 'READY' : 'REFUSED';
}

export default function SeriesScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const now = new Date();
  const catalog = useQuery(catalogQuery);
  const trend = useQuery(performanceQuery);

  const series = catalog.data?.series.find((row) => row.id === id);
  const phase = phaseOf(catalog, series);
  const progress = series ? seriesProgress(series) : null;
  const results = resultsByTest(trend.data?.points ?? []);
  const sat = (trend.data?.points ?? []).filter((point) =>
    (series?.tests ?? []).some((test) => test.id === point.testId),
  );
  const sittables = phase === 'READY' && series ? sittablesOf([series]) : [];

  return (
    <Fragment>
      <Stack.Screen options={{ title: series?.name ?? 'Series' }} />
      <FlatList
        className="flex-1 bg-background"
        contentContainerStyle={CONTENT_STYLE}
        data={sittables}
        keyExtractor={keyOfTest}
        renderItem={renderTest(now, results)}
        ListHeaderComponent={
          series && progress ? (
            <SeriesHeader series={series} progress={progress} trend={trend} sat={sat} />
          ) : null
        }
        ListEmptyComponent={<SeriesBody phase={phase} onRetry={catalog.refetch} />}
      />
    </Fragment>
  );
}

function SeriesBody({ phase, onRetry }: Readonly<{ phase: Phase; onRetry: () => void }>) {
  if (phase === 'LOADING') {
    return (
      <View className="gap-3">
        <Skeleton className="h-24 rounded-xl" />
        <Skeleton className="h-32 rounded-xl" />
      </View>
    );
  }
  if (phase === 'ERROR') {
    return (
      <EmptyState
        kind={EMPTY_STATE_KINDS.FAILURE}
        title="This series did not load"
        onRetry={onRetry}
      />
    );
  }
  if (phase === 'REFUSED') {
    return <EmptyState kind={EMPTY_STATE_KINDS.REFUSED} title="This series is not one you reach" />;
  }
  return <EmptyState title="No tests yet" />;
}

function SeriesHeader({
  series,
  progress,
  trend,
  sat,
}: Readonly<{
  series: StudentCatalogSeries;
  progress: SeriesProgress;
  trend: { isLoading: boolean; isError: boolean; refetch: () => void };
  sat: readonly PerformancePoint[];
}>) {
  return (
    <View className="gap-4 pb-2">
      <View className="flex-row items-start justify-between gap-3">
        <View className="flex-1">
          <Text variant="title">{series.name}</Text>
          <Text variant="muted">
            {progress.done} of {plural(progress.total, 'test')} done
          </Text>
        </View>
        <Link href={ROUTES.PERFORMANCE} asChild>
          <Button variant="ghost" size="sm">
            Your performance
          </Button>
        </Link>
      </View>

      <Standing trend={trend} progress={progress} sat={sat} />

      {series.sequentialTests ? (
        <Alert>These open one at a time: finish the test before it to reach the next.</Alert>
      ) : null}

      <View className="flex-row items-baseline justify-between">
        <Text variant="section">Tests</Text>
        <Text variant="muted">{plural(series.tests.length, 'test')}</Text>
      </View>
    </View>
  );
}

/** The performance query's own load state — two of these three figures come from it, not the catalog. */
function Standing({
  trend,
  progress,
  sat,
}: Readonly<{
  trend: { isLoading: boolean; isError: boolean; refetch: () => void };
  progress: SeriesProgress;
  sat: readonly PerformancePoint[];
}>) {
  if (trend.isLoading) return <Skeleton className="h-24 rounded-xl" />;
  if (trend.isError) {
    return (
      <EmptyState
        kind={EMPTY_STATE_KINDS.FAILURE}
        title="Your performance did not load"
        onRetry={trend.refetch}
      />
    );
  }

  const mean = averageAccuracy(sat);

  return (
    <View className="flex-row gap-3">
      <StatBlock label="Tests done" value={progress.done} unit={`/ ${progress.total}`} />
      <StatBlock label="Best rank" value={bestRank(sat)} />
      <StatBlock label="Average accuracy" value={mean} unit={mean === '—' ? undefined : '%'} />
    </View>
  );
}

function StatBlock({
  label,
  value,
  unit,
}: Readonly<{ label: string; value: string | number; unit?: string }>) {
  return (
    <Card className="flex-1 gap-1 p-4">
      <Text variant="meta">{label}</Text>
      <Text className="text-xl font-semibold text-foreground">
        {value}
        {unit ? <Text variant="metaStrong"> {unit}</Text> : null}
      </Text>
    </Card>
  );
}

const keyOfTest = (row: Sittable) => row.test.id;

/** A stable factory, not a component declared inside another — `now`/`results` close over it. */
const renderTest =
  (now: Date, results: ReadonlyMap<string, TestResult>) =>
  ({ item }: { item: Sittable }) => (
    <TestTile row={item} now={now} result={results.get(item.test.id)} fullWidth />
  );
