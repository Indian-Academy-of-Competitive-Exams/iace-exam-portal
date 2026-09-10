import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Alert, ComparisonCards, plural, type ComparisonItem } from '@iace/ui';
import {
  EVALUATION_MODE,
  LEADERBOARD_SCOPES,
  PERFORMANCE_SCOPES,
  percentLabel,
  type CohortCurve,
  type EvaluationMode,
  type PerformanceReport,
} from '@iace/contracts';
import { api } from '../lib/api';
import {
  PERFORMANCE_QUERY_KEY,
  leaderboardQueryKey,
  performanceReportQueryKey,
} from '../lib/constants';
import { PageBody, ReportSkeleton, RowsSkeleton, Section } from '../components/ui';
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

  // `scopeId` on an ATTEMPT report is the ATTEMPT's id, so the paper has to come from elsewhere.
  const points = trend.data?.points ?? [];
  const testId =
    report.data?.cohort?.testId ??
    points.find((point) => point.attemptId === attemptId)?.testId ??
    '';
  // A crowd is not a ranking: a practice paper has sittings and no board, so the MODE decides.
  const mode = report.data?.evaluationMode ?? null;
  const placed = mode === EVALUATION_MODE.RANKED && (report.data?.cohort?.cohortSize ?? 0) > 0;
  const board = useQuery({
    queryKey: leaderboardQueryKey(LEADERBOARD_SCOPES.TEST, testId),
    queryFn: () => api.me.leaderboard({ scope: LEADERBOARD_SCOPES.TEST, testId }),
    enabled: placed && testId !== '',
  });

  if (report.isLoading) return <ReportSkeleton />;
  if (!report.data) return null;

  const sittings = points.filter((point) => point.testId === testId);

  return (
    <PageBody>
      {placed ? (
        <Against cohort={report.data.cohort} report={report.data} />
      ) : (
        <AttemptCompare sittings={sittings} cohort={report.data.cohort} />
      )}

      <Standing mode={mode} placed={placed} />

      {placed ? (
        <Section title="Leaderboard">
          {board.isLoading ? <RowsSkeleton rows={5} /> : null}
          {board.data ? (
            <>
              <Podium rows={board.data.podium} />
              <Standings board={board.data} empty="Nobody has been ranked on this paper yet" />
            </>
          ) : null}
        </Section>
      ) : null}
    </PageBody>
  );
}

/** Only the ranked-but-unplaced case: a practice paper says its own piece inside the comparison. */
function Standing({ mode, placed }: Readonly<{ mode: EvaluationMode | null; placed: boolean }>) {
  if (placed || mode !== EVALUATION_MODE.RANKED) return null;

  return (
    /* ui-copy-ok: consequence */
    <Alert variant="info">
      Nobody has been ranked on this paper yet, so it stands against your own attempts for now.
    </Alert>
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
      label: 'Average',
      value: cohort.averageScore ?? 0,
      max,
      display: String(cohort.averageScore ?? '—'),
      segments: [
        { key: 'average', label: 'Marks', value: cohort.averageScore ?? 0, tone: 'neutral' },
      ],
      caption: plural(cohort.cohortSize, 'sitting'),
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
