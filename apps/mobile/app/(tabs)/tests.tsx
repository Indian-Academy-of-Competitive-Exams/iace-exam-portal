import { useMemo } from 'react';
import { FlatList, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import {
  matching,
  resultsByTest,
  sittablesOf,
  type Sittable,
  type TestResult,
} from '@iace/app-kit';
import {
  courseLabel,
  EXAM_COURSES,
  TEST_BUCKET,
  type ExamCourse,
  type StudentCatalogSeries,
} from '@iace/contracts';
import { catalogQuery, performanceQuery } from '../../src/lib/queries';
import { Alert } from '../../src/components/ui/alert';
import { EmptyState, EMPTY_STATE_KINDS } from '../../src/components/ui/empty-state';
import { Skeleton } from '../../src/components/ui/skeleton';
import { FilterBar } from '../../src/components/ui/filter-bar';
import { SeriesShelf } from '../../src/components/tests/series-shelf';
import {
  asText,
  useFilterState,
  type Filter,
  type FilterOption,
  type FilterState,
} from '../../src/lib/filters';
import { plural } from '../../src/lib/plural';

const ANY = '';

/** The keys this screen filters on, named once so the spec and the reads cannot drift. */
const KEYS = { SEARCH: 'q', COURSE: 'course', STATE: 'state', SERIES: 'seriesId' } as const;

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
  const filters = useMemo(() => filterSpec(reaches), [reaches]);
  const state = useFilterState(filters);

  const q = asText(state.values[KEYS.SEARCH]);
  const course = asText(state.values[KEYS.COURSE]);
  const bucket = asText(state.values[KEYS.STATE]);
  const seriesId = asText(state.values[KEYS.SERIES]);

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
  filters: readonly Filter[];
  state: FilterState;
}

function TestsHeader({ count, testBlocked, filters, state }: Readonly<TestsHeaderProps>) {
  return (
    <View className="gap-4 pb-2">
      <View>
        <Text className="text-2xl font-bold tracking-tight text-foreground">Tests</Text>
        <Text className="text-sm text-muted-foreground">{plural(count, 'test')}</Text>
      </View>

      {testBlocked ? (
        <Alert variant="danger">
          Your test access is on hold. Nothing here can be started until your branch lifts it.
        </Alert>
      ) : null}

      <FilterBar state={state} filters={filters} />
    </View>
  );
}

/** One spec: the search and the state a shelf is scanned for stay out; the long lists fold. */
function filterSpec(series: readonly StudentCatalogSeries[]): Filter[] {
  const courses = courseOptionsOf(series);
  const seriesRows = seriesOptionsOf(series);

  return [
    {
      key: KEYS.SEARCH,
      kind: 'search',
      label: 'Search your tests',
      placeholder: 'Search your tests',
    },
    { key: KEYS.STATE, kind: 'choice', label: 'State', primary: true, items: STATE_OPTIONS },
    // Offering only "Any" offers nothing, so each waits for a real second option.
    ...(courses.length > 2
      ? [{ key: KEYS.COURSE, kind: 'choice' as const, label: 'Exam', items: courses }]
      : []),
    ...(seriesRows.length > 2
      ? [{ key: KEYS.SERIES, kind: 'choice' as const, label: 'Series', items: seriesRows }]
      : []),
  ];
}

/** Where a paper stands for this student — the one thing they scan a shelf for. */
const STATE_OPTIONS: readonly FilterOption[] = [
  { value: ANY, label: 'Any state' },
  { value: TEST_BUCKET.OPEN, label: 'Open now' },
  { value: TEST_BUCKET.LATER, label: 'Scheduled' },
  { value: TEST_BUCKET.DONE, label: 'Done' },
];

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

/** Only the exams this student actually reaches; a filter offering nothing is noise. */
function courseOptionsOf(series: readonly StudentCatalogSeries[]): FilterOption[] {
  const held = new Set(
    series.map((row) => row.examStage?.course).filter((one): one is ExamCourse => Boolean(one)),
  );
  return [
    { value: ANY, label: 'Any exam' },
    ...EXAM_COURSES.filter((one) => held.has(one)).map((one) => ({
      value: one,
      label: courseLabel(one),
    })),
  ];
}

/** Only the series this student reaches; a filter offering one row is a filter offering nothing. */
function seriesOptionsOf(series: readonly StudentCatalogSeries[]): FilterOption[] {
  return [
    { value: ANY, label: 'Any series' },
    ...series.map((row) => ({ value: row.id, label: row.name })),
  ];
}

const keyOfShelf = (shelf: Shelf) => shelf.series.id;

/** A stable factory, not a component declared inside another — `now`/`results` close over it. */
const renderShelf =
  (now: Date, results: ReadonlyMap<string, TestResult>) =>
  ({ item }: { item: Shelf }) => (
    <SeriesShelf series={item.series} rows={item.tests} now={now} results={results} />
  );
