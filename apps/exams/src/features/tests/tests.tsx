/**
 * The student's tests. A DELIBERATE deviation from the list-screen convention: this is discovery
 * rather than an admin data table, so it is a shelf per series, not a ListView. A shelf is a
 * sample: the tiles that fit one row, and the series' own screen for the rest.
 */
import { useQuery } from '@tanstack/react-query';
import { PageCrumbs, useFilterSpec, usePageTour } from '@iace/app-kit/browser';
import {
  ANY_CHOICE,
  EMPTINESS,
  SHUT_SAYS,
  asSet,
  asText,
  emptyReason,
  everySitting,
  resultsByTest,
  testsFilters,
  testsShelves,
  type Emptiness,
  type TestResult,
  type TestsShelf,
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
import { TEST_SHUT } from '@iace/contracts';
import { catalogQuery, performanceQuery } from '../../lib/queries';
import { NAV_ITEMS } from '../../lib/constants';
import { TESTS_TOUR, TOUR_IDS } from '../../lib/tours';
import { SeriesShelf } from './series-shelf';
import { PageBody } from '../../components/ui';

const SKELETON_KEYS = ['a', 'b', 'c'];

export function TestsPage() {
  const catalog = useQuery(catalogQuery);
  const trend = useQuery(performanceQuery);

  usePageTour({ id: TOUR_IDS.TESTS, steps: TESTS_TOUR, ready: catalog.isSuccess });

  const FILTERS = testsFilters(catalog.data?.series ?? []) as ListFilter[];

  const filters = useFilterSpec(FILTERS);
  const course = asText(filters.values.course) || ANY_CHOICE;

  const now = new Date();
  const reaches = catalog.data?.series ?? [];
  const { rows, shelves } = testsShelves(reaches, {
    q: asText(filters.values.q),
    course,
    state: asText(filters.values.state) || ANY_CHOICE,
    series: asSet(filters.values.series),
  });
  const emptiness = emptyReason(reaches, rows.length);
  const results = resultsByTest(everySitting(trend.data));

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
          <Alert variant="danger">{SHUT_SAYS[TEST_SHUT.HOLD].notice}</Alert>
        ) : null}

        <CatalogRegion
          catalog={catalog}
          emptiness={emptiness}
          shelves={shelves}
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
  shelves,
  now,
  results,
}: Readonly<{
  catalog: { isLoading: boolean; isError: boolean; refetch: () => void };
  emptiness: Emptiness;
  shelves: readonly TestsShelf[];
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

  if (emptiness === EMPTINESS.NONE) {
    return (
      <EmptyState
        title="No tests yet"
        /* ui-copy-ok: rule */ hint="Your branch adds them as they open."
      />
    );
  }
  if (emptiness === EMPTINESS.FILTERED)
    return <EmptyState kind={EMPTY_STATE_KINDS.FILTERED} title="Nothing matches" />;

  return (
    <>
      {shelves.map(({ series, tests }) => (
        <SeriesShelf key={series.id} series={series} rows={tests} now={now} results={results} />
      ))}
    </>
  );
}
