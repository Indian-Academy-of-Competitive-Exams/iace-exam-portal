import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { LockKeyhole } from 'lucide-react';
import {
  EmptyState,
  EMPTY_STATE_KINDS,
  Alert,
  Badge,
  Button,
  DataTable,
  PageFrame,
  PageHeader,
  Skeleton,
  TruncatedText,
  linkVariants,
  plural,
  type DataTableColumn,
} from '@iace/ui';
import { PageCrumbs } from '@iace/app-kit/browser';
import {
  INSTITUTE_TIME_ZONE,
  PERFORMANCE_SCOPES,
  TEST_BUCKET,
  testAction,
  testBucket,
  type PerformancePoint,
  type StudentCatalogTest,
} from '@iace/contracts';
import { api } from '../lib/api';
import {
  CATALOG_QUERY_KEY,
  NAV_ITEMS,
  PERFORMANCE_QUERY_KEY,
  ROUTES,
  performanceReportQueryKey,
} from '../lib/constants';
import { MasteryFigure, RampFigure } from '../components/performance/progression-figures';
import {
  BlockSkeleton,
  PageBody,
  Section,
  StatTile,
  TileGrid,
  TilesSkeleton,
} from '../components/ui';
import { averageAccuracy, bestRank, seriesProgress, type SeriesProgress } from '../lib/catalog';

const WHEN = new Intl.DateTimeFormat('en-IN', {
  timeZone: INSTITUTE_TIME_ZONE,
  dateStyle: 'medium',
  timeStyle: 'short',
});

const BUCKET_BADGE: Readonly<Record<string, 'success' | 'neutral' | 'warning'>> = {
  [TEST_BUCKET.DONE]: 'success',
  [TEST_BUCKET.OPEN]: 'success',
  [TEST_BUCKET.LATER]: 'neutral',
};

const BUCKET_LABEL: Readonly<Record<string, string>> = {
  [TEST_BUCKET.DONE]: 'Done',
  [TEST_BUCKET.OPEN]: 'Open now',
  [TEST_BUCKET.LATER]: 'Later',
};

export function SeriesPage() {
  const { seriesId = '' } = useParams();
  const now = new Date();

  const catalog = useQuery({ queryKey: CATALOG_QUERY_KEY, queryFn: () => api.me.catalog() });
  const trend = useQuery({ queryKey: PERFORMANCE_QUERY_KEY, queryFn: () => api.me.performance() });
  // A ramp is only drawn where an admin said the papers harden; every other series has no shape.
  const report = useQuery({
    queryKey: performanceReportQueryKey(PERFORMANCE_SCOPES.SERIES, seriesId),
    queryFn: () => api.me.performanceReport({ scope: PERFORMANCE_SCOPES.SERIES, seriesId }),
  });
  const progression = report.data?.progression ?? null;

  const series = catalog.data?.series.find((row) => row.id === seriesId);
  const progress = series ? seriesProgress(series) : null;
  const sat = (trend.data?.points ?? []).filter((point) =>
    (series?.tests ?? []).some((test) => test.id === point.testId),
  );

  return (
    <PageFrame
      header={
        <PageHeader
          breadcrumbs={
            <PageCrumbs
              nav={NAV_ITEMS}
              tail={[{ label: 'Tests', to: ROUTES.TESTS }, { label: series?.name ?? 'Series' }]}
            />
          }
          size="display"
          title={series?.name ?? 'Series'}
          meta={progress ? `${progress.done} of ${plural(progress.total, 'test')} done` : undefined}
          action={
            <Button asChild variant="outline">
              <Link to={ROUTES.PERFORMANCE}>Your performance</Link>
            </Button>
          }
        />
      }
    >
      <PageBody>
        {catalog.isLoading ? (
          <>
            <TilesSkeleton count={3} />
            <BlockSkeleton />
          </>
        ) : null}
        {catalog.data && !series ? (
          <EmptyState kind={EMPTY_STATE_KINDS.REFUSED} title="This series is not one you reach" />
        ) : null}

        {series && progress ? (
          <>
            <Standing trend={trend} progress={progress} sat={sat} />

            {series.sequentialTests ? (
              /* ui-copy-ok: rule */
              <Alert variant="info">
                <span className="flex items-center gap-2">
                  <LockKeyhole aria-hidden />
                  These open one at a time: finish the test before it to reach the next.
                </span>
              </Alert>
            ) : null}

            <Section title="Tests" meta={plural(series.tests.length, 'test')}>
              <DataTable
                columns={episodeColumns(now)}
                rows={series.tests}
                rowKey={(row) => row.id}
                isLoading={catalog.isLoading}
                empty="Nothing has been put in this series yet"
              />
            </Section>
          </>
        ) : null}

        {progression ? (
          <>
            <RampFigure progression={progression} />
            {progression.subjects.length > 0 ? (
              <MasteryFigure subjects={progression.subjects} />
            ) : null}
          </>
        ) : null}
      </PageBody>
    </PageFrame>
  );
}

/** The performance query's own load state — two of these three figures come from it, not the catalog. */
function Standing({
  trend,
  progress,
  sat,
}: Readonly<{
  trend: { isLoading: boolean; isError: boolean; refetch: () => void };
  progress: SeriesProgress;
  sat: readonly PerformancePoint[];
}>) {
  if (trend.isLoading) return <Skeleton variant="row" className="h-24 rounded-xl" />;
  if (trend.isError) {
    return (
      <EmptyState
        kind={EMPTY_STATE_KINDS.FAILURE}
        title="Your performance did not load"
        onRetry={trend.refetch}
      />
    );
  }

  const mean = averageAccuracy(sat);

  return (
    <TileGrid>
      <StatTile label="Tests done" value={progress.done} unit={`/ ${progress.total}`} />
      <StatTile label="Best rank" value={bestRank(sat)} />
      <StatTile label="Average accuracy" value={mean} unit={mean === '—' ? undefined : '%'} />
    </TileGrid>
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
        <Badge variant={BUCKET_BADGE[testBucket(row)] ?? 'neutral'}>
          {BUCKET_LABEL[testBucket(row)]}
        </Badge>
      ),
    },
    { key: 'when', header: 'When', cell: (row) => whenLine(row, now) },
    {
      key: 'sat',
      header: 'Sat by',
      numeric: true,
      cell: (row) => row.sittingCount ?? '—',
    },
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

/** A test opens and never shuts, so there are only two things to say about when. */
function whenLine(test: StudentCatalogTest, now: Date): string {
  if (test.opensAt !== null && Date.parse(test.opensAt) > now.getTime()) {
    return `Opens ${WHEN.format(new Date(test.opensAt))}`;
  }
  return 'Any time';
}

/** Why there is no button. "Waiting its turn" is not an error and must not read like one. */
function shutReason(test: StudentCatalogTest, now: Date): string {
  if (test.opensAt !== null && Date.parse(test.opensAt) > now.getTime()) return 'Not open yet';
  return 'Waiting its turn';
}
