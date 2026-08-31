import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ClipboardList } from 'lucide-react';
import {
  Alert,
  Button,
  DataTable,
  EmptyState,
  LoadingState,
  MeasureBars,
  Metric,
  MetricGroup,
  PageFrame,
  PageHeader,
  SectionHeading,
  StatRow,
  TrendLine,
  TruncatedText,
  linkVariants,
  plural,
  type DataTableColumn,
  type MeasureBar,
  type TrendPoint,
} from '@iace/ui';
import {
  type AnalyticsBucket,
  type AttemptAnalytics,
  type PerformancePoint,
  type PerformanceTrend,
} from '@iace/contracts';
import { api } from '../lib/api';
import { PERFORMANCE_QUERY_KEY, ROUTES, analyticsQueryKey } from '../lib/constants';
import { averageAccuracy, bestRank } from '../lib/catalog';

const TREND_COLUMNS: readonly DataTableColumn<PerformancePoint>[] = [
  {
    key: 'test',
    header: 'Test',
    className: 'max-w-[18rem]',
    cell: (row) => (
      <Link className={linkVariants()} to={ROUTES.SCORE_CARD(row.attemptId)}>
        <TruncatedText>{row.testTitle ?? 'Untitled test'}</TruncatedText>
      </Link>
    ),
  },
  { key: 'marks', header: 'Marks', cell: (row) => `${row.score} / ${row.maxMarks}` },
  { key: 'percentage', header: 'Percentage', numeric: true, cell: (row) => `${row.percentage}%` },
  { key: 'accuracy', header: 'Accuracy', numeric: true, cell: (row) => `${row.accuracy}%` },
  { key: 'rank', header: 'Rank', numeric: true, cell: (row) => row.rank ?? '—' },
  { key: 'percentile', header: 'Percentile', numeric: true, cell: (row) => row.percentile ?? '—' },
];

export function PerformancePage() {
  const trend = useQuery({
    queryKey: PERFORMANCE_QUERY_KEY,
    queryFn: () => api.me.performance(),
  });
  const latest = trend.data?.points.at(-1)?.attemptId ?? '';
  const detail = useQuery({
    queryKey: analyticsQueryKey(latest),
    queryFn: () => api.me.analytics(latest),
    enabled: latest !== '',
  });

  let body;
  if (trend.isLoading) {
    body = <LoadingState />;
  } else if (trend.isError) {
    body = <Alert variant="danger">Your performance did not load.</Alert>;
  } else if (trend.data && trend.data.points.length > 0) {
    body = (
      <div className="flex flex-col gap-8">
        <Trend trend={trend.data} />
        {detail.data ? <LatestPaper analytics={detail.data} /> : null}
      </div>
    );
  } else {
    body = (
      <EmptyState
        icon={ClipboardList}
        title="No tests sat yet"
        action={
          <Button asChild>
            <Link to={ROUTES.TESTS}>Go to your tests</Link>
          </Button>
        }
      />
    );
  }

  return (
    <PageFrame
      header={
        <PageHeader
          title="Performance"
          meta={trend.data ? plural(trend.data.testsSat, 'test') : undefined}
        />
      }
    >
      {body}
    </PageFrame>
  );
}

function Trend({ trend }: Readonly<{ trend: PerformanceTrend }>) {
  const points: TrendPoint[] = trend.points.map((point) => ({
    key: point.attemptId,
    label: point.testTitle ?? 'Untitled test',
    value: point.accuracy,
    caption: `${point.score} of ${point.maxMarks} marks`,
  }));
  const best = bestRank(trend.points);
  const mean = averageAccuracy(trend.points);

  return (
    <div className="flex flex-col gap-8">
      <MetricGroup>
        <Metric label="Tests done" value={trend.testsSat} />
        <Metric label="Best rank" value={best} />
        <Metric label="Average accuracy" value={mean} unit={mean === '—' ? undefined : '%'} />
      </MetricGroup>

      <section className="flex flex-col gap-3">
        <SectionHeading title="Accuracy" />
        <TrendLine points={points} unit="%" aria-label="Accuracy across your tests" />
      </section>

      <DataTable
        columns={TREND_COLUMNS}
        rows={[...trend.points].reverse()}
        rowKey={(row) => row.attemptId}
        isLoading={false}
        empty="You have not sat a test yet."
      />
    </div>
  );
}

function LatestPaper({ analytics }: Readonly<{ analytics: AttemptAnalytics }>) {
  const { cohort, time, strategy } = analytics;

  return (
    <div className="flex flex-col gap-8">
      <SectionHeading title="Last paper" meta={analytics.testTitle} />
      <section className="flex flex-col gap-3">
        <SectionHeading title="Subjects" level={3} />
        <MeasureBars bars={analytics.subjects.map(toAccuracyBar)} max={100} />
      </section>

      <section className="flex flex-col gap-3">
        <SectionHeading title="Difficulty" level={3} />
        <MeasureBars bars={analytics.difficulty.map(toAccuracyBar)} max={100} />
      </section>

      <section className="flex flex-col gap-3">
        <SectionHeading title="Cohort" level={3} />
        <MeasureBars
          bars={[
            { key: 'you', label: 'You', value: cohort.score, tone: 1 },
            { key: 'average', label: 'Cohort average', value: cohort.averageScore ?? 0, tone: 2 },
            { key: 'topper', label: 'Topper', value: cohort.topperScore ?? 0, tone: 3 },
          ]}
          max={cohort.topperScore ?? cohort.score}
        />
      </section>

      <section className="grid gap-x-8 gap-y-2 sm:grid-cols-2">
        <SectionHeading title="Time" level={3} className="sm:col-span-2" />
        <StatRow label="Average per question" value={`${time.avgPerQuestionSec}s`} />
        <StatRow label="Average on a right answer" value={`${time.avgOnCorrectSec}s`} />
        <StatRow label="Average on a wrong answer" value={`${time.avgOnWrongSec}s`} />
        <StatRow label="Spent on questions you left" value={`${time.spentOnUnattemptedSec}s`} />
        <StatRow label="Answered" value={strategy.answered} />
        <StatRow label="Answered and marked" value={strategy.answeredAndMarked} />
        <StatRow label="Marked only" value={strategy.markedOnly} />
        <StatRow label="Seen and left" value={strategy.seenAndLeft} />
        <StatRow label="Never opened" value={strategy.neverOpened} />
      </section>
    </div>
  );
}

const toAccuracyBar = (bucket: AnalyticsBucket): MeasureBar => ({
  key: bucket.key,
  label: bucket.name,
  value: bucket.accuracy,
  display: bucket.attempted === 0 ? '—' : `${bucket.accuracy}%`,
});
