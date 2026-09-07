import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Alert, LoadingState } from '@iace/ui';
import { ComparisonCards, type ComparisonItem } from '@iace/ui';
import {
  LEADERBOARD_SCOPES,
  PERFORMANCE_SCOPES,
  percentLabel,
  type CohortCurve,
  type PerformanceReport,
} from '@iace/contracts';
import { api } from '../lib/api';
import {
  PERFORMANCE_QUERY_KEY,
  leaderboardQueryKey,
  performanceReportQueryKey,
} from '../lib/constants';
import { PageBody, Section } from '../components/ui';
import { AttemptCompare } from '../components/performance/attempt-compare';
import { Podium, Standings } from '../components/leaderboard/board';

/** Who else sat this paper. Without a cohort the benchmark swaps rather than the tab disappearing. */
export function ComparePanel() {
  const { attemptId = '' } = useParams();
  const report = useQuery({
    queryKey: performanceReportQueryKey(PERFORMANCE_SCOPES.ATTEMPT, attemptId),
    queryFn: () => api.me.performanceReport({ scope: PERFORMANCE_SCOPES.ATTEMPT, attemptId }),
  });
  const trend = useQuery({ queryKey: PERFORMANCE_QUERY_KEY, queryFn: () => api.me.performance() });

  const testId = report.data?.scopeId ?? '';
  const ranked = (report.data?.cohort?.cohortSize ?? 0) > 0;
  const board = useQuery({
    queryKey: leaderboardQueryKey(LEADERBOARD_SCOPES.TEST, testId),
    queryFn: () => api.me.leaderboard({ scope: LEADERBOARD_SCOPES.TEST, testId }),
    enabled: ranked && testId !== '',
  });

  if (report.isLoading) return <LoadingState />;
  if (!report.data) return null;

  const sittings = (trend.data?.points ?? []).filter((point) => point.testId === testId);

  return (
    <PageBody>
      {ranked ? (
        <Against cohort={report.data.cohort} report={report.data} />
      ) : (
        <AttemptCompare sittings={sittings} cohort={report.data.cohort} />
      )}

      {ranked ? (
        <Section title="Leaderboard">
          {board.isLoading ? <LoadingState /> : null}
          {board.data ? (
            <>
              <Podium rows={board.data.podium} />
              <Standings board={board.data} empty="Nobody has been ranked on this paper yet." />
            </>
          ) : null}
        </Section>
      ) : (
        /* ui-copy-ok: consequence */
        <Alert variant="info">
          This sitting is not ranked, so it stands against your own best rather than a cohort.
        </Alert>
      )}
    </PageBody>
  );
}

/** You, the field's average and the paper's topper on one scale of marks. */
function Against({
  cohort,
  report,
}: Readonly<{ cohort: CohortCurve | null; report: PerformanceReport }>) {
  if (cohort === null) return null;
  const max = report.composition.maxMarks;

  const items: ComparisonItem[] = [
    {
      key: 'you',
      label: 'You',
      value: cohort.score,
      max,
      display: String(cohort.score),
      segments: [{ key: 'you', label: 'Marks', value: cohort.score, tone: 'positive' }],
      caption: percentLabel(cohort.percentile, '—'),
      tone: 'current',
    },
    {
      key: 'average',
      label: 'Cohort average',
      value: cohort.averageScore ?? 0,
      max,
      display: String(cohort.averageScore ?? '—'),
      segments: [
        { key: 'average', label: 'Marks', value: cohort.averageScore ?? 0, tone: 'neutral' },
      ],
      caption: `${cohort.cohortSize} sittings`,
    },
    {
      key: 'topper',
      label: 'Topper',
      value: cohort.topperScore ?? 0,
      max,
      display: String(cohort.topperScore ?? '—'),
      segments: [
        { key: 'topper', label: 'Marks', value: cohort.topperScore ?? 0, tone: 'positive' },
      ],
      caption: `of ${max} marks`,
      tone: 'good',
    },
  ];

  return <ComparisonCards items={items} />;
}
