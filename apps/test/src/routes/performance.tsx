import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Alert,
  DataTable,
  LoadingState,
  MeasureBars,
  PageFrame,
  PageHeader,
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

  return (
    <PageFrame
      header={
        <PageHeader
          title="Performance"
          meta={trend.data ? plural(trend.data.testsSat, 'test') : undefined}
        />
      }
    >
      {trend.isLoading ? <LoadingState /> : null}
      {trend.data?.points.length === 0 ? (
        <Alert variant="info">Sit a test and your performance starts here.</Alert>
      ) : null}
      {trend.data && trend.data.points.length > 0 ? (
        <div className="flex flex-col gap-8">
          <Trend trend={trend.data} />
          {detail.data ? <LatestPaper analytics={detail.data} /> : null}
        </div>
      ) : null}
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

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold text-foreground">Accuracy</h2>
      <TrendLine points={points} unit="%" aria-label="Accuracy across your tests" />
      <DataTable
        columns={TREND_COLUMNS}
        rows={[...trend.points].reverse()}
        rowKey={(row) => row.attemptId}
        isLoading={false}
        empty="You have not sat a test yet."
      />
    </section>
  );
}

function LatestPaper({ analytics }: Readonly<{ analytics: AttemptAnalytics }>) {
  const { cohort, time, strategy } = analytics;

  return (
    <div className="flex flex-col gap-8">
      <h2 className="flex items-baseline gap-2 text-sm font-semibold text-foreground">
        <span>Last paper</span>
        <span className="font-normal text-muted-foreground">{analytics.testTitle}</span>
      </h2>
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-foreground">Subjects</h2>
        <MeasureBars bars={analytics.subjects.map(toAccuracyBar)} max={100} />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-foreground">Difficulty</h2>
        <MeasureBars bars={analytics.difficulty.map(toAccuracyBar)} max={100} />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-foreground">Cohort</h2>
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
        <h2 className="text-sm font-semibold text-foreground sm:col-span-2">Time</h2>
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
