import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { FREE_SERIES_EXAM_CAP, type OpenSeries } from '@iace/contracts';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  PageFrame,
  PageHeader,
  SkeletonParagraph,
} from '@iace/ui';
import { PageCrumbs } from '@iace/app-kit/browser';
import { api } from '../lib/api';
import { BROWSE_QUERY_KEY, CATALOG_QUERY_KEY, NAV_ITEMS } from '../lib/constants';

export function BrowsePage() {
  const queryClient = useQueryClient();

  const open = useQuery({
    queryKey: BROWSE_QUERY_KEY,
    queryFn: () => api.me.openSeries(),
  });

  const ask = useMutation({
    meta: { success: 'Asked. You will hear when it is answered.' },
    mutationFn: (testSeriesId: string) => api.me.askForSeries(testSeriesId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: BROWSE_QUERY_KEY });
      await queryClient.invalidateQueries({ queryKey: CATALOG_QUERY_KEY });
    },
  });

  const examsHeld = open.data?.examsHeld ?? [];
  const atCap = examsHeld.length >= FREE_SERIES_EXAM_CAP;
  const rows = open.data?.series ?? [];

  return (
    <PageFrame
      header={<PageHeader breadcrumbs={<PageCrumbs nav={NAV_ITEMS} />} title="Free tests" />}
    >
      {atCap ? (
        <Alert variant="info" className="mb-5">
          <span>
            Free tests run to {FREE_SERIES_EXAM_CAP} exams, and yours are taken. Ask the institute
            if you need another.
          </span>
        </Alert>
      ) : null}

      {open.isPending ? <SkeletonParagraph lines={4} /> : null}

      {!open.isPending && rows.length === 0 ? (
        <Alert variant="info">There is no free test to ask for at the moment.</Alert>
      ) : null}

      <div className="grid gap-3 md:grid-cols-2">
        {rows.map((series) => (
          <SeriesCard
            key={series.id}
            series={series}
            askable={
              !atCap || (series.examStage !== null && examsHeld.includes(series.examStage.examCode))
            }
            busy={ask.isPending}
            onAsk={() => ask.mutate(series.id)}
          />
        ))}
      </div>
    </PageFrame>
  );
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
          <h3 className="truncate text-sm font-semibold text-foreground">{series.name}</h3>
          {series.examStage ? (
            <p className="truncate text-xs text-muted-foreground">
              {series.examStage.examCode} · {series.examStage.name}
            </p>
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
