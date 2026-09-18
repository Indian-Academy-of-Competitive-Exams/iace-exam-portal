import { useMemo } from 'react';
import { FlatList, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import {
  ANY_CHOICE,
  matching,
  resultsByTest,
  sittablesOf,
  testsFilters,
  type Sittable,
  type TestResult,
} from '@iace/app-kit';
import { type StudentCatalogSeries } from '@iace/contracts';
import { catalogQuery, performanceQuery } from '../../src/lib/queries';
import { Alert } from '../../src/components/ui/alert';
import { EmptyState, EMPTY_STATE_KINDS } from '../../src/components/ui/empty-state';
import { Skeleton } from '../../src/components/ui/skeleton';
import { FilterSearch, FilterSummary, FilterTrigger } from '../../src/components/ui/filter-bar';
import { SeriesShelf } from '../../src/components/tests/series-shelf';
import { asText, useFilterState, type FilterSpec, type FilterState } from '../../src/lib/filters';
import { plural } from '../../src/lib/plural';

const ANY = ANY_CHOICE;

/** Reaching nothing and searching for nothing are different facts, and they read differently. */
type Emptiness = 'NONE' | 'FILTERED' | null;

interface Shelf {
  series: StudentCatalogSeries;
  tests: Sittable[];
}

export default function TestsScreen() {
  const catalog = useQuery(catalogQuery);
  const trend = useQuery(performanceQuery);

  const reaches = useMemo(() => catalog.data?.series ?? [], [catalog.data]);
  const filters = useMemo(() => testsFilters(reaches), [reaches]);
  const state = useFilterState(filters);

  const q = asText(state.values.q);
  const course = asText(state.values.course);
  const bucket = asText(state.values.state);
  const seriesId = asText(state.values.series);

  const now = new Date();
  const filteredSeries = reaches
    .filter((row) => course === ANY || row.examStage?.course === course)
    .filter((row) => seriesId === ANY || row.id === seriesId);
  const rows = inState(matching(sittablesOf(filteredSeries), q), bucket);
  const emptiness = emptyReasonOf(reaches.length, rows.length);
  const results = resultsByTest(trend.data?.points ?? []);

  return (
    <FlatList
      className="bg-background"
      contentContainerStyle={CONTENT_STYLE}
      data={shelvesOf(filteredSeries, rows)}
      keyExtractor={keyOfShelf}
      renderItem={renderShelf(now, results)}
      ListHeaderComponent={
        <TestsHeader
          count={rows.length}
          testBlocked={catalog.data?.testBlocked ?? false}
          filters={filters}
          state={state}
        />
      }
      ListEmptyComponent={
        <CatalogBody
          isLoading={catalog.isLoading}
          isError={catalog.isError}
          onRetry={catalog.refetch}
          emptiness={emptiness}
        />
      }
    />
  );
}

const CONTENT_STYLE = { paddingHorizontal: 20, paddingTop: 24, paddingBottom: 32, gap: 32 };

/** The catalog's own load state, distinct from a genuinely empty one — an error is not "none yet". */
function CatalogBody({
  isLoading,
  isError,
  onRetry,
  emptiness,
}: Readonly<{
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  emptiness: Emptiness;
}>) {
  if (isLoading) {
    return (
      <View className="gap-4">
        <Skeleton className="h-56 rounded-xl" />
        <Skeleton className="h-56 rounded-xl" />
      </View>
    );
  }
  if (isError) {
    return (
      <EmptyState
        kind={EMPTY_STATE_KINDS.FAILURE}
        title="Your tests did not load"
        onRetry={onRetry}
      />
    );
  }
  if (emptiness === 'NONE') {
    return (
      <EmptyState
        title="No tests yet"
        // ui-copy-ok: rule — how one arrives is not something the student can trigger
        hint="Your branch adds them as they open."
      />
    );
  }
  if (emptiness === 'FILTERED') {
    return <EmptyState kind={EMPTY_STATE_KINDS.FILTERED} title="Nothing matches" />;
  }
  return null;
}

interface TestsHeaderProps {
  count: number;
  testBlocked: boolean;
  filters: readonly FilterSpec[];
  state: FilterState;
}

function TestsHeader({ count, testBlocked, filters, state }: Readonly<TestsHeaderProps>) {
  return (
    <View className="gap-4 pb-2">
      <View className="flex-row items-start justify-between gap-3">
        <View className="flex-1">
          <Text className="text-2xl font-bold tracking-tight text-foreground">Tests</Text>
          <Text className="text-sm text-muted-foreground">{plural(count, 'test')}</Text>
        </View>
        <FilterTrigger state={state} filters={filters} />
      </View>

      {testBlocked ? (
        <Alert variant="danger">
          Your test access is on hold. Nothing here can be started until your branch lifts it.
        </Alert>
      ) : null}

      <FilterSearch state={state} filters={filters} />
      <FilterSummary state={state} filters={filters} />
    </View>
  );
}

const inState = (rows: readonly Sittable[], state: string) =>
  state === ANY ? [...rows] : rows.filter((row) => row.bucket === state);

function emptyReasonOf(reached: number, showing: number): Emptiness {
  if (reached === 0) return 'NONE';
  return showing === 0 ? 'FILTERED' : null;
}

/** A shelf per series, and no shelf for one the search or filters emptied. */
function shelvesOf(series: readonly StudentCatalogSeries[], rows: readonly Sittable[]): Shelf[] {
  return series
    .map((row) => ({ series: row, tests: rows.filter((sittable) => sittable.seriesId === row.id) }))
    .filter((shelf) => shelf.tests.length > 0);
}

const keyOfShelf = (shelf: Shelf) => shelf.series.id;

/** A stable factory, not a component declared inside another — `now`/`results` close over it. */
const renderShelf =
  (now: Date, results: ReadonlyMap<string, TestResult>) =>
  ({ item }: { item: Shelf }) => (
    <SeriesShelf series={item.series} rows={item.tests} now={now} results={results} />
  );
