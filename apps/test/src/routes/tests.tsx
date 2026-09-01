/**
 * The student's tests. A DELIBERATE deviation from the list-screen convention: this is discovery
 * rather than an admin data table, so it is a status strip over series shelves, not a ListView.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useFilterSpec } from '@iace/app-kit/browser';
import { ClipboardList, LockKeyhole, SearchX } from 'lucide-react';
import {
  Alert,
  Badge,
  Button,
  EmptyState,
  PageHeader,
  PanelFrame,
  Skeleton,
  plural,
  type ListFilter,
} from '@iace/ui';
import {
  EXAM_FAMILIES,
  TEST_SERIES_KIND,
  type ExamFamily,
  type StudentCatalogSeries,
} from '@iace/contracts';
import { api } from '../lib/api';
import { CATALOG_QUERY_KEY } from '../lib/constants';
import { matching, sittablesOf, type Sittable } from '../lib/catalog';
import { SeriesShelf } from '../components/tests/series-shelf';
import { StatusStrip } from '../components/tests/status-strip';

/** AP_TS_POLICE reads as AP/TS POLICE. The underscore is a storage detail. */
const familyLabel = (family: string) => family.replaceAll('_', '/');

const ANY_FAMILY = '';
const SKELETON_KEYS = ['a', 'b', 'c'];

/** Reaching nothing and searching for nothing are different facts, and they read differently. */
type Emptiness = 'NONE' | 'FILTERED' | null;

export function TestsPage() {
  const queryClient = useQueryClient();
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
      key: 'family',
      kind: 'choice',
      label: 'Exam',
      primary: true,
      items: familyItems(catalog.data?.series ?? []),
    },
  ] as const satisfies readonly ListFilter[];

  const filters = useFilterSpec(FILTERS);
  const family = filters.values.family || ANY_FAMILY;

  const ask = useMutation({
    meta: { success: 'Asked. You will hear when it is answered.' },
    mutationFn: (testSeriesId: string) => api.me.askForSeries(testSeriesId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CATALOG_QUERY_KEY }),
  });

  const now = new Date();
  // Free series have their own tab, so this screen is the paid journey and only that.
  const reaches = (catalog.data?.series ?? []).filter((row) => row.kind !== TEST_SERIES_KIND.FREE);
  const series = reaches.filter((row) => family === ANY_FAMILY || row.examStage?.family === family);
  const rows = matching(sittablesOf(series, now), filters.values.q);
  const shut = series.filter((row) => row.canRequestUnlock);
  const emptiness = emptyReason(reaches.length, rows.length);

  return (
    <PanelFrame
      header={<PageHeader title="Tests" meta={plural(rows.length, 'test')} />}
      filters={{ spec: FILTERS, state: filters }}
    >
      <div className="mb-5 flex flex-col gap-4">
        {catalog.data?.testBlocked ? (
          /* ui-copy-ok: consequence */
          <Alert variant="danger">
            Your test access is on hold. Nothing here can be started until your branch lifts it.
          </Alert>
        ) : null}

        {shut.map((row) => (
          <ShutSeries
            key={row.id}
            series={row}
            onAsk={() => ask.mutate(row.id)}
            asking={ask.isPending}
          />
        ))}
      </div>

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

/** Only the families this student actually reaches; a filter offering nothing is noise. */
function familyItems(series: readonly StudentCatalogSeries[]) {
  const held = new Set(
    series.map((row) => row.examStage?.family).filter((one): one is ExamFamily => Boolean(one)),
  );
  return [
    { value: ANY_FAMILY, label: 'Any exam' },
    ...EXAM_FAMILIES.filter((one) => held.has(one)).map((one) => ({
      value: one,
      label: familyLabel(one),
    })),
  ];
}

/** A shut series names what opens it, and carries the only thing the student can do about it. */
function ShutSeries({
  series,
  onAsk,
  asking,
}: Readonly<{ series: StudentCatalogSeries; onAsk: () => void; asking: boolean }>) {
  return (
    /* ui-copy-ok: consequence */
    <Alert variant="info">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="flex items-start gap-2">
          <LockKeyhole aria-hidden />
          <span>
            <strong className="font-medium">{series.name}</strong>{' '}
            {series.prerequisiteSeriesName === null
              ? 'is not open to you yet.'
              : `opens once you have finished every test in ${series.prerequisiteSeriesName}.`}
          </span>
        </span>
        {series.unlockRequested ? (
          <Badge variant="neutral">Asked — waiting to be answered</Badge>
        ) : (
          <Button size="sm" disabled={asking} onClick={onAsk}>
            Ask to open it now
          </Button>
        )}
      </div>
    </Alert>
  );
}
