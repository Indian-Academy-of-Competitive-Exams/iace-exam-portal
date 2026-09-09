/**
 * The student's tests. A DELIBERATE deviation from the list-screen convention: this is discovery
 * rather than an admin data table, so it is a shelf per series, not a ListView.
 */
import { useQuery } from '@tanstack/react-query';
import { PageCrumbs, useFilterSpec } from '@iace/app-kit/browser';
import { ClipboardList, SearchX } from 'lucide-react';
import {
  Alert,
  EmptyState,
  PageFrame,
  PageHeader,
  Skeleton,
  plural,
  type ListFilter,
} from '@iace/ui';
import {
  EXAM_COURSES,
  TEST_BUCKET,
  type ExamCourse,
  type StudentCatalogSeries,
} from '@iace/contracts';
import { api } from '../lib/api';
import { CATALOG_QUERY_KEY, courseLabel, NAV_ITEMS, PERFORMANCE_QUERY_KEY } from '../lib/constants';
import {
  matching,
  resultsByTest,
  sittablesOf,
  type Sittable,
  type TestResult,
} from '../lib/catalog';
import { SeriesShelf } from '../components/tests/series-shelf';
import { PageBody } from '../components/ui';

const ANY_FAMILY = '';
const SKELETON_KEYS = ['a', 'b', 'c'];

/** Reaching nothing and searching for nothing are different facts, and they read differently. */
type Emptiness = 'NONE' | 'FILTERED' | null;

export function TestsPage() {
  const catalog = useQuery({ queryKey: CATALOG_QUERY_KEY, queryFn: () => api.me.catalog() });
  const trend = useQuery({ queryKey: PERFORMANCE_QUERY_KEY, queryFn: () => api.me.performance() });

  const FILTERS = [
    {
      key: 'q',
      kind: 'search',
      label: 'Search tests',
      primary: true,
      placeholder: 'Search your tests',
    },
    {
      key: 'course',
      kind: 'choice',
      label: 'Exam',
      primary: true,
      items: courseItems(catalog.data?.series ?? []),
    },
    {
      key: 'state',
      kind: 'choice',
      label: 'State',
      items: STATE_ITEMS,
    },
    {
      key: 'series',
      kind: 'choice',
      label: 'Series',
      items: seriesItems(catalog.data?.series ?? []),
    },
  ] as const satisfies readonly ListFilter[];

  const filters = useFilterSpec(FILTERS);
  const course = filters.values.course || ANY_FAMILY;

  const now = new Date();
  const reaches = catalog.data?.series ?? [];
  const chosenSeries = filters.values.series || ANY_FAMILY;
  const series = reaches
    .filter((row) => course === ANY_FAMILY || row.examStage?.course === course)
    .filter((row) => chosenSeries === ANY_FAMILY || row.id === chosenSeries);
  const rows = inState(
    matching(sittablesOf(series), filters.values.q),
    filters.values.state || ANY_FAMILY,
  );
  const emptiness = emptyReason(reaches.length, rows.length);
  const results = resultsByTest(trend.data?.points ?? []);

  return (
    <PageFrame
      header={
        <PageHeader
          breadcrumbs={<PageCrumbs nav={NAV_ITEMS} />}
          size="display"
          title="Tests"
          meta={plural(rows.length, 'test')}
        />
      }
      filters={{ spec: FILTERS, state: filters }}
      filtersBesideTitle
    >
      <PageBody>
        {catalog.data?.testBlocked ? (
          /* ui-copy-ok: consequence */
          <Alert variant="danger">
            Your test access is on hold. Nothing here can be started until your branch lifts it.
          </Alert>
        ) : null}

        <CatalogRegion
          catalog={catalog}
          emptiness={emptiness}
          series={series}
          rows={rows}
          now={now}
          results={results}
        />
      </PageBody>
    </PageFrame>
  );
}

/** The catalog's own load state, distinct from a genuinely empty one — an error is not "none yet". */
function CatalogRegion({
  catalog,
  emptiness,
  series,
  rows,
  now,
  results,
}: Readonly<{
  catalog: { isLoading: boolean; isError: boolean };
  emptiness: Emptiness;
  series: readonly StudentCatalogSeries[];
  rows: readonly Sittable[];
  now: Date;
  results: ReadonlyMap<string, TestResult>;
}>) {
  if (catalog.isLoading) {
    return (
      <div className="flex flex-col gap-10">
        {SKELETON_KEYS.map((key) => (
          <Skeleton key={key} variant="row" className="h-52 rounded-xl" />
        ))}
      </div>
    );
  }
  if (catalog.isError) return <Alert variant="danger">Your tests did not load.</Alert>;

  if (emptiness === 'NONE') {
    return (
      <EmptyState
        icon={ClipboardList}
        title="No tests yet"
        /* ui-copy-ok: rule */ hint="Your branch adds them as they open."
      />
    );
  }
  if (emptiness === 'FILTERED') return <EmptyState icon={SearchX} title="Nothing matches" />;

  return (
    <>
      {shelves(series, rows).map(({ row, tests }) => (
        <SeriesShelf key={row.id} series={row} rows={tests} now={now} results={results} />
      ))}
    </>
  );
}

function emptyReason(reached: number, showing: number): Emptiness {
  if (reached === 0) return 'NONE';
  return showing === 0 ? 'FILTERED' : null;
}

/** A shelf per series, and no shelf for one the search emptied. */
function shelves(
  series: readonly StudentCatalogSeries[],
  rows: readonly Sittable[],
): { row: StudentCatalogSeries; tests: Sittable[] }[] {
  return series
    .map((row) => ({ row, tests: rows.filter((sittable) => sittable.seriesId === row.id) }))
    .filter(({ tests }) => tests.length > 0);
}

/** Where a paper stands for this student — the one thing they scan a shelf for. */
const STATE_ITEMS = [
  { value: ANY_FAMILY, label: 'Any state' },
  { value: TEST_BUCKET.OPEN, label: 'Open now' },
  { value: TEST_BUCKET.LATER, label: 'Scheduled' },
  { value: TEST_BUCKET.DONE, label: 'Done' },
] as const;

const inState = (rows: readonly Sittable[], state: string) =>
  state === ANY_FAMILY ? [...rows] : rows.filter((row) => row.bucket === state);

/** Only the series this student reaches; a filter offering one row is a filter offering nothing. */
function seriesItems(series: readonly StudentCatalogSeries[]) {
  return [
    { value: ANY_FAMILY, label: 'Any series' },
    ...series.map((row) => ({ value: row.id, label: row.name })),
  ];
}

/** Only the courses this student actually reaches; a filter offering nothing is noise. */
function courseItems(series: readonly StudentCatalogSeries[]) {
  const held = new Set(
    series.map((row) => row.examStage?.course).filter((one): one is ExamCourse => Boolean(one)),
  );
  return [
    { value: ANY_FAMILY, label: 'Any exam' },
    ...EXAM_COURSES.filter((one) => held.has(one)).map((one) => ({
      value: one,
      label: courseLabel(one),
    })),
  ];
}
