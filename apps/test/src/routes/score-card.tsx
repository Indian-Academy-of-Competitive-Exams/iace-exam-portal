import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Alert,
  DataTable,
  LoadingState,
  Metric,
  MetricGroup,
  Progress,
  SectionHeading,
  StatRow,
  TruncatedText,
  plural,
  type DataTableColumn,
} from '@iace/ui';
import {
  CohortFigure,
  DifficultyFigure,
  MarksFigure,
  TimeFigure,
  TrajectoryFigure,
} from '@iace/app-kit/browser';
import {
  PERFORMANCE_SCOPES,
  paperCounts,
  type PerformanceReport,
  type ScoreCard,
  type ScoreCardSection,
} from '@iace/contracts';
import { api } from '../lib/api';
import { performanceReportQueryKey, scoreCardQueryKey } from '../lib/constants';

const SECTION_COLUMNS: readonly DataTableColumn<ScoreCardSection>[] = [
  {
    key: 'name',
    header: 'Section',
    className: 'max-w-[16rem]',
    cell: (row) => <TruncatedText>{row.name}</TruncatedText>,
  },
  { key: 'marks', header: 'Marks', cell: (row) => `${row.score} / ${row.maxMarks}` },
  { key: 'correct', header: 'Correct', numeric: true, cell: (row) => row.correctCount },
  { key: 'wrong', header: 'Wrong', numeric: true, cell: (row) => row.wrongCount },
  { key: 'left', header: 'Unattempted', numeric: true, cell: (row) => row.unattemptedCount },
  { key: 'time', header: 'Time', cell: (row) => minutes(row.timeSpentSec) },
];

export function ScoreCardPanel() {
  const { attemptId = '' } = useParams();
  const card = useQuery({
    queryKey: scoreCardQueryKey(attemptId),
    queryFn: () => api.me.scoreCard(attemptId),
  });
  const report = useQuery({
    queryKey: performanceReportQueryKey(PERFORMANCE_SCOPES.ATTEMPT, attemptId),
    queryFn: () => api.me.performanceReport({ scope: PERFORMANCE_SCOPES.ATTEMPT, attemptId }),
  });

  return (
    <>
      {card.isLoading ? <LoadingState /> : null}
      {card.data ? <Result card={card.data} report={report.data ?? null} /> : null}
    </>
  );
}

function Result({ card, report }: Readonly<{ card: ScoreCard; report: PerformanceReport | null }>) {
  const attempted = card.correctCount + card.wrongCount;
  const accuracy = attempted === 0 ? 0 : Math.round((card.correctCount / attempted) * 100);
  // A curve exists only where a cohort drew one; a retake or a practice paper has none to show.
  const curve = report?.cohort && report.cohort.bands.length > 0 ? report.cohort : null;
  const trajectory = report?.trajectory ?? [];

  return (
    <div className="flex flex-col gap-6">
      {card.provisional ? (
        /* ui-copy-ok: consequence */
        <Alert variant="info">
          This standing can still move: others can still sit this test. It settles once the test has
          closed for everyone.
        </Alert>
      ) : null}

      {card.isGraded ? null : (
        /* ui-copy-ok: consequence */
        <Alert variant="info">
          This was a retake, so it is marked but it does not carry a rank.
        </Alert>
      )}

      <MetricGroup>
        <Metric label="Percentile" value={card.percentile ?? '—'} />
        <Metric
          label="Rank"
          value={card.rank ?? '—'}
          unit={
            card.rank === null || card.cohortSize === null ? undefined : `of ${card.cohortSize}`
          }
        />
        <Metric label="Marks" value={card.score} unit={`/ ${card.maxMarks}`} />
        <Metric label="Percentage" value={card.percentage} unit="%" />
        <Metric label="Questions" value={card.totalQuestions} />
        <Metric label="Duration" value={minutes(card.durationSec)} />
      </MetricGroup>

      <div className="grid gap-x-8 gap-y-2 sm:grid-cols-2">
        <StatRow label="Correct" value={card.correctCount} />
        <StatRow label="Wrong" value={card.wrongCount} />
        <StatRow label="Unattempted" value={card.unattemptedCount} />
        <StatRow
          label="Time taken"
          value={`${minutes(card.timeTakenSec)} of ${minutes(card.durationSec)}`}
        />
      </div>

      <div className="flex flex-col gap-2">
        <SectionHeading title="Accuracy" />
        <Progress value={accuracy} aria-label="Accuracy" />
        <StatRow
          label={`${card.correctCount} right of ${plural(attempted, 'attempt')}`}
          value={`${accuracy}%`}
        />
      </div>

      {curve === null ? null : <CohortFigure cohort={curve} />}

      {report === null ? null : (
        <>
          <MarksFigure composition={report.composition} counts={paperCounts(report.sections)} />
          <div className="grid items-start gap-4 lg:grid-cols-2">
            <DifficultyFigure difficulty={report.difficulty} />
            <TimeFigure
              time={report.time}
              counts={paperCounts(report.sections)}
              paceIndex={report.paceIndex}
            />
          </div>
        </>
      )}

      <div className="flex min-h-0 flex-col gap-2">
        <SectionHeading title="Sections" />
        <DataTable
          columns={SECTION_COLUMNS}
          rows={card.sections}
          rowKey={(row) => row.baseConfigSectionId}
          isLoading={false}
          empty="This paper had no sections."
        />
      </div>

      {trajectory.length > 1 ? <TrajectoryFigure trajectory={trajectory} /> : null}
    </div>
  );
}

/** Seconds read as minutes on a result screen; nobody counts a paper in seconds. */
function minutes(seconds: number): string {
  const whole = Math.floor(seconds / 60);
  return whole === 0 ? `${seconds}s` : `${whole}m`;
}
