/**
 * The student's tests. A DELIBERATE deviation from the list-screen convention: this is discovery
 * rather than an admin data table, so it is a status strip over series shelves, not a ListView.
 */
import { useQuery } from '@tanstack/react-query';
import { useFilterSpec } from '@iace/app-kit/browser';
import { ClipboardList, SearchX } from 'lucide-react';
import {
  Alert,
  EmptyState,
  PageHeader,
  PanelFrame,
  Skeleton,
  plural,
  type ListFilter,
} from '@iace/ui';
import { EXAM_COURSES, type ExamCourse, type StudentCatalogSeries } from '@iace/contracts';
import { api } from '../lib/api';
import { CATALOG_QUERY_KEY } from '../lib/constants';
import { matching, sittablesOf, type Sittable } from '../lib/catalog';
import { SeriesShelf } from '../components/tests/series-shelf';
import { StatusStrip } from '../components/tests/status-strip';

/** AP_TS_POLICE reads as AP/TS POLICE. The underscore is a storage detail. */
const courseLabel = (course: string) => course.replaceAll('_', '/');

const ANY_FAMILY = '';
const SKELETON_KEYS = ['a', 'b', 'c'];

/** Reaching nothing and searching for nothing are different facts, and they read differently. */
type Emptiness = 'NONE' | 'FILTERED' | null;

export function TestsPage() {
  const catalog = useQuery({ queryKey: CATALOG_QUERY_KEY, queryFn: () => api.me.catalog() });

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
  ] as const satisfies readonly ListFilter[];

  const filters = useFilterSpec(FILTERS);
  const course = filters.values.course || ANY_FAMILY;

  const now = new Date();
  const reaches = catalog.data?.series ?? [];
  const series = reaches.filter((row) => course === ANY_FAMILY || row.examStage?.course === course);
  const rows = matching(sittablesOf(series, now), filters.values.q);
  const emptiness = emptyReason(reaches.length, rows.length);

  return (
    <PanelFrame
      header={<PageHeader title="Tests" meta={plural(rows.length, 'test')} />}
      filters={{ spec: FILTERS, state: filters }}
    >
      {catalog.data?.testBlocked ? (
        /* ui-copy-ok: consequence */
        <Alert variant="danger" className="mb-5">
          Your test access is on hold. Nothing here can be started until your branch lifts it.
        </Alert>
      ) : null}

      <CatalogRegion
        catalog={catalog}
        emptiness={emptiness}
        series={series}
        rows={rows}
        now={now}
      />
    </PanelFrame>
  );
}

/** The catalog's own load state, distinct from a genuinely empty one — an error is not "none yet". */
function CatalogRegion({
  catalog,
  emptiness,
  series,
  rows,
  now,
}: Readonly<{
  catalog: { isLoading: boolean; isError: boolean };
  emptiness: Emptiness;
  series: readonly StudentCatalogSeries[];
  rows: readonly Sittable[];
  now: Date;
}>) {
  if (catalog.isLoading) {
    return (
      <div className="flex flex-col gap-3">
        {SKELETON_KEYS.map((key) => (
          <Skeleton key={key} variant="row" className="h-40 rounded-lg" />
        ))}
      </div>
    );
  }
  if (catalog.isError) {
    return <Alert variant="danger">Your tests did not load.</Alert>;
  }
  return (
    <div className="flex flex-col gap-8">
      <CatalogBody emptiness={emptiness} series={series} rows={rows} now={now} />
    </div>
  );
}

function emptyReason(reached: number, showing: number): Emptiness {
  if (reached === 0) return 'NONE';
  return showing === 0 ? 'FILTERED' : null;
}

function CatalogBody({
  emptiness,
  series,
  rows,
  now,
}: Readonly<{
  emptiness: Emptiness;
  series: readonly StudentCatalogSeries[];
  rows: readonly Sittable[];
  now: Date;
}>) {
  if (emptiness === null) {
    return (
      <>
        <StatusStrip rows={rows} now={now} />
        {shelves(series, rows).map(({ row, tests }) => (
          <SeriesShelf key={row.id} series={row} rows={tests} now={now} />
        ))}
      </>
    );
  }
  if (emptiness === 'NONE') {
    return (
      <EmptyState
        icon={ClipboardList}
        title="No tests yet"
        /* ui-copy-ok: rule */ hint="Your branch adds them as they open."
      />
    );
  }
  return <EmptyState icon={SearchX} title="Nothing matches" />;
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
