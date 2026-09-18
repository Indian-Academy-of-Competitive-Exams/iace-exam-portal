/**
 * The student's tests. A DELIBERATE deviation from the list-screen convention: this is discovery
 * rather than an admin data table, so it is a shelf per series, not a ListView.
 */
import { useQuery } from '@tanstack/react-query';
import { PageCrumbs, useFilterSpec } from '@iace/app-kit/browser';
import {
  ANY_CHOICE,
  asText,
  matching,
  resultsByTest,
  sittablesOf,
  testsFilters,
  type Sittable,
  type TestResult,
} from '@iace/app-kit';
import {
  Alert,
  EmptyState,
  EMPTY_STATE_KINDS,
  PageFrame,
  PageHeader,
  Skeleton,
  plural,
  type ListFilter,
} from '@iace/ui';
import { type StudentCatalogSeries } from '@iace/contracts';
import { catalogQuery, performanceQuery } from '../lib/queries';
import { NAV_ITEMS } from '../lib/constants';
import { SeriesShelf } from '../components/tests/series-shelf';
import { PageBody } from '../components/ui';

const SKELETON_KEYS = ['a', 'b', 'c'];

/** Reaching nothing and searching for nothing are different facts, and they read differently. */
type Emptiness = 'NONE' | 'FILTERED' | null;

export function TestsPage() {
  const catalog = useQuery(catalogQuery);
  const trend = useQuery(performanceQuery);

  const FILTERS = testsFilters(catalog.data?.series ?? []) as ListFilter[];

  const filters = useFilterSpec(FILTERS);
  const course = asText(filters.values.course) || ANY_CHOICE;

  const now = new Date();
  const reaches = catalog.data?.series ?? [];
  const chosenSeries = asText(filters.values.series) || ANY_CHOICE;
  const series = reaches
    .filter((row) => course === ANY_CHOICE || row.examStage?.course === course)
    .filter((row) => chosenSeries === ANY_CHOICE || row.id === chosenSeries);
  const rows = inState(
    matching(sittablesOf(series), asText(filters.values.q)),
    asText(filters.values.state) || ANY_CHOICE,
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
  catalog: { isLoading: boolean; isError: boolean; refetch: () => void };
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
  if (catalog.isError) {
    return (
      <EmptyState
        kind={EMPTY_STATE_KINDS.FAILURE}
        title="Your tests did not load"
        onRetry={catalog.refetch}
      />
    );
  }

  if (emptiness === 'NONE') {
    return (
      <EmptyState
        title="No tests yet"
        /* ui-copy-ok: rule */ hint="Your branch adds them as they open."
      />
    );
  }
  if (emptiness === 'FILTERED')
    return <EmptyState kind={EMPTY_STATE_KINDS.FILTERED} title="Nothing matches" />;

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
const inState = (rows: readonly Sittable[], state: string) =>
  state === ANY_CHOICE ? [...rows] : rows.filter((row) => row.bucket === state);
