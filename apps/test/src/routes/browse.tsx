import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Gift, Plus } from 'lucide-react';
import {
  FREE_SERIES_EXAM_CAP,
  TEST_SERIES_KIND,
  type OpenSeries,
  type StudentCatalogSeries,
} from '@iace/contracts';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  EmptyState,
  PageFrame,
  PageHeader,
  SectionHeading,
  Skeleton,
  TruncatedText,
  plural,
} from '@iace/ui';
import { api } from '../lib/api';
import { BROWSE_QUERY_KEY, CATALOG_QUERY_KEY } from '../lib/constants';
import { sittablesOf, type Sittable } from '../lib/catalog';
import { SeriesShelf } from '../components/tests/series-shelf';

const SKELETON_KEYS = ['a', 'b'];

/** Free content reads exactly as paid content does — the same shelves, in their own tab. */
export function BrowsePage() {
  const queryClient = useQueryClient();

  const catalog = useQuery({ queryKey: CATALOG_QUERY_KEY, queryFn: () => api.me.catalog() });
  const open = useQuery({ queryKey: BROWSE_QUERY_KEY, queryFn: () => api.me.openSeries() });

  const ask = useMutation({
    meta: { success: 'Asked. You will hear when it is answered.' },
    mutationFn: (testSeriesId: string) => api.me.askForSeries(testSeriesId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: BROWSE_QUERY_KEY });
      await queryClient.invalidateQueries({ queryKey: CATALOG_QUERY_KEY });
    },
  });

  const now = new Date();
  const mine = (catalog.data?.series ?? []).filter((row) => row.kind === TEST_SERIES_KIND.FREE);
  const rows = sittablesOf(mine, now);

  const examsHeld = open.data?.examsHeld ?? [];
  const atCap = examsHeld.length >= FREE_SERIES_EXAM_CAP;
  const askable = open.data?.series ?? [];

  return (
    <PageFrame header={<PageHeader title="Free tests" meta={plural(rows.length, 'test')} />}>
      {atCap ? (
        /* ui-copy-ok: limit */
        <Alert variant="info" className="mb-5">
          Free tests run to {FREE_SERIES_EXAM_CAP} exams, and yours are taken. Ask the institute if
          you need another.
        </Alert>
      ) : null}

      {catalog.isLoading || open.isPending ? (
        <div className="flex flex-col gap-3">
          {SKELETON_KEYS.map((key) => (
            <Skeleton key={key} variant="row" className="h-40 rounded-lg" />
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-8">
          {shelves(mine, rows).map(({ row, tests }) => (
            <SeriesShelf key={row.id} series={row} rows={tests} now={now} />
          ))}

          {askable.length > 0 ? (
            <section className="flex flex-col gap-3">
              <SectionHeading title="Open to ask for" />
              <div className="grid gap-3 md:grid-cols-2">
                {askable.map((series) => (
                  <SeriesCard
                    key={series.id}
                    series={series}
                    askable={
                      !atCap ||
                      (series.examStage !== null && examsHeld.includes(series.examStage.examCode))
                    }
                    busy={ask.isPending}
                    onAsk={() => ask.mutate(series.id)}
                  />
                ))}
              </div>
            </section>
          ) : null}

          {rows.length === 0 && askable.length === 0 ? (
            <EmptyState icon={Gift} title="No free tests to ask for" />
          ) : null}
        </div>
      )}
    </PageFrame>
  );
}

function shelves(
  series: readonly StudentCatalogSeries[],
  rows: readonly Sittable[],
): { row: StudentCatalogSeries; tests: Sittable[] }[] {
  return series
    .map((row) => ({ row, tests: rows.filter((sittable) => sittable.seriesId === row.id) }))
    .filter(({ tests }) => tests.length > 0);
}

function SeriesCard({
  series,
  askable,
  busy,
  onAsk,
}: Readonly<{ series: OpenSeries; askable: boolean; busy: boolean; onAsk: () => void }>) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-4">
        <div className="flex min-w-0 flex-col gap-1">
          <TruncatedText className="text-md font-semibold text-foreground">
            {series.name}
          </TruncatedText>
          {series.examStage ? (
            <TruncatedText className="text-sm text-muted-foreground">
              {`${series.examStage.examCode} · ${series.examStage.name}`}
            </TruncatedText>
          ) : null}
        </div>

        {series.pending ? (
          <Badge variant="warning">Asked — waiting to be answered</Badge>
        ) : (
          // Left out rather than disabled: past the cap this is not a thing they can do today.
          askable && (
            <Button size="sm" variant="outline" loading={busy} onClick={onAsk}>
              <Plus aria-hidden />
              Ask for access
            </Button>
          )
        )}
      </CardContent>
    </Card>
  );
}
