import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { LockKeyhole } from 'lucide-react';
import {
  Alert,
  Badge,
  Button,
  DataTable,
  LoadingState,
  PageFrame,
  PageHeader,
  Progress,
  StatRow,
  TruncatedText,
  linkVariants,
  plural,
  type DataTableColumn,
} from '@iace/ui';
import { PageCrumbs } from '@iace/app-kit/browser';
import {
  INSTITUTE_TIME_ZONE,
  TEST_BUCKET,
  testAction,
  testBucket,
  type StudentCatalogTest,
} from '@iace/contracts';
import { api } from '../lib/api';
import { CATALOG_QUERY_KEY, NAV_ITEMS, PERFORMANCE_QUERY_KEY, ROUTES } from '../lib/constants';
import { seriesProgress } from '../lib/catalog';

const WHEN = new Intl.DateTimeFormat('en-IN', {
  timeZone: INSTITUTE_TIME_ZONE,
  dateStyle: 'medium',
  timeStyle: 'short',
});

const BUCKET_BADGE: Readonly<Record<string, 'success' | 'neutral' | 'warning'>> = {
  [TEST_BUCKET.DONE]: 'success',
  [TEST_BUCKET.OPEN]: 'success',
  [TEST_BUCKET.LATER]: 'neutral',
  [TEST_BUCKET.MISSED]: 'warning',
};

const BUCKET_LABEL: Readonly<Record<string, string>> = {
  [TEST_BUCKET.DONE]: 'Done',
  [TEST_BUCKET.OPEN]: 'Open now',
  [TEST_BUCKET.LATER]: 'Later',
  [TEST_BUCKET.MISSED]: 'Missed',
};

export function SeriesPage() {
  const { seriesId = '' } = useParams();
  const now = new Date();

  const catalog = useQuery({ queryKey: CATALOG_QUERY_KEY, queryFn: () => api.me.catalog() });
  const trend = useQuery({ queryKey: PERFORMANCE_QUERY_KEY, queryFn: () => api.me.performance() });

  const series = catalog.data?.series.find((row) => row.id === seriesId);
  const progress = series ? seriesProgress(series) : null;
  const sat = (trend.data?.points ?? []).filter((point) =>
    (series?.tests ?? []).some((test) => test.id === point.testId),
  );

  return (
    <PageFrame
      header={
        <PageHeader
          breadcrumbs={<PageCrumbs nav={NAV_ITEMS} tail={[{ label: series?.name ?? 'Series' }]} />}
          title={series?.name ?? 'Series'}
          meta={progress ? `${progress.done} of ${plural(progress.total, 'test')} done` : undefined}
          action={
            <Button asChild variant="outline">
              <Link to={ROUTES.PERFORMANCE}>Your standing</Link>
            </Button>
          }
        />
      }
    >
      {catalog.isLoading ? <LoadingState /> : null}
      {catalog.data && !series ? (
        <Alert variant="warning">This series is not one you reach.</Alert>
      ) : null}

      {series && progress ? (
        <div className="grid min-h-0 gap-6 lg:grid-cols-[1fr_18rem]">
          <div className="flex min-h-0 flex-col gap-4">
            {series.sequentialTests ? (
              /* ui-copy-ok: rule */
              <Alert variant="info">
                <span className="flex items-center gap-2">
                  <LockKeyhole aria-hidden />
                  These open one at a time: finish the test before it to reach the next.
                </span>
              </Alert>
            ) : null}

            <Progress value={progress.percent} aria-label="Tests done in this series" />

            <DataTable
              columns={episodeColumns(now)}
              rows={series.tests}
              rowKey={(row) => row.id}
              isLoading={false}
              empty="Nothing has been put in this series yet."
            />
          </div>

          <aside className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold text-foreground">Your standing</h2>
            <StatRow label="Tests done" value={`${progress.done} / ${progress.total}`} />
            <StatRow label="Best rank" value={bestRank(sat)} />
            <StatRow label="Average accuracy" value={averageAccuracy(sat)} />
          </aside>
        </div>
      ) : null}
    </PageFrame>
  );
}

function episodeColumns(now: Date): readonly DataTableColumn<StudentCatalogTest>[] {
  return [
    {
      key: 'title',
      header: 'Test',
      className: 'max-w-[20rem]',
      cell: (row) => (
        <Link className={linkVariants()} to={ROUTES.TEST_ABOUT(row.id)}>
          <TruncatedText>{row.title ?? 'Untitled test'}</TruncatedText>
        </Link>
      ),
    },
    {
      key: 'state',
      header: 'State',
      cell: (row) => (
        <Badge variant={BUCKET_BADGE[testBucket(row, now)] ?? 'neutral'}>
          {BUCKET_LABEL[testBucket(row, now)]}
        </Badge>
      ),
    },
    { key: 'when', header: 'When', cell: (row) => whenLine(row, now) },
    {
      key: 'go',
      cell: (row) => {
        const action = testAction(row);
        if (action) {
          return (
            <Button asChild size="sm">
              <Link to={ROUTES.TEST_INSTRUCTIONS(row.id)}>
                {action === 'RESUME' ? 'Resume' : 'Start'}
              </Link>
            </Button>
          );
        }
        return <span className="text-xs text-muted-foreground">{shutReason(row, now)}</span>;
      },
    },
  ];
}

function whenLine(test: StudentCatalogTest, now: Date): string {
  if (test.opensAt !== null && Date.parse(test.opensAt) > now.getTime()) {
    return `Opens ${WHEN.format(new Date(test.opensAt))}`;
  }
  if (test.closesAt !== null) {
    const closed = Date.parse(test.closesAt) <= now.getTime();
    return `${closed ? 'Entry closed' : 'Entry closes'} ${WHEN.format(new Date(test.closesAt))}`;
  }
  return 'Any time';
}

/** Why there is no button. "Waiting its turn" is not an error and must not read like one. */
function shutReason(test: StudentCatalogTest, now: Date): string {
  if (test.opensAt !== null && Date.parse(test.opensAt) > now.getTime()) return 'Not open yet';
  if (test.closesAt !== null && Date.parse(test.closesAt) <= now.getTime()) return 'Entry closed';
  return 'Waiting its turn';
}

const bestRank = (points: readonly { rank: number | null }[]) => {
  const ranked = points.map((point) => point.rank).filter((rank) => rank !== null);
  return ranked.length === 0 ? '—' : Math.min(...ranked);
};

const averageAccuracy = (points: readonly { accuracy: number }[]) => {
  if (points.length === 0) return '—';
  const mean = points.reduce((sum, point) => sum + point.accuracy, 0) / points.length;
  return `${Math.round(mean)}%`;
};
