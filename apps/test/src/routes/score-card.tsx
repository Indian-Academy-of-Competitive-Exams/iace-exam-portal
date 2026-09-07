import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Alert,
  DataTable,
  LoadingState,
  Metric,
  Progress,
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
import {
  Hero,
  HeroFigure,
  PageBody,
  Section,
  SurfaceCard,
  TileGrid,
  StatTile,
} from '../components/ui';

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

  if (card.isLoading) return <LoadingState />;
  if (!card.data) return null;

  return <Result card={card.data} report={report.data ?? null} />;
}

function Result({ card, report }: Readonly<{ card: ScoreCard; report: PerformanceReport | null }>) {
  const attempted = card.correctCount + card.wrongCount;
  const accuracy = attempted === 0 ? 0 : Math.round((card.correctCount / attempted) * 100);
  // A curve exists only where a cohort drew one; a retake or a practice paper has none to show.
  const curve = report?.cohort && report.cohort.bands.length > 0 ? report.cohort : null;
  const trajectory = report?.trajectory ?? [];

  return (
    <PageBody>
      <Hero
        tone="accent"
        eyebrow="Your result"
        title="Score card"
        figure={
          <HeroFigure
            value={card.percentile ?? '—'}
            unit={card.percentile === null ? undefined : 'th'}
            caption={beaten(card)}
          />
        }
        aside={
          <>
            <Metric
              label="Rank"
              value={card.rank ?? '—'}
              unit={
                card.rank === null || card.cohortSize === null ? undefined : `of ${card.cohortSize}`
              }
              size="md"
            />
            <Metric label="Marks" value={card.score} unit={`/ ${card.maxMarks}`} size="md" />
            <Metric label="Accuracy" value={accuracy} unit="%" size="md" />
          </>
        }
      />

      {card.provisional ? (
        /* ui-copy-ok: consequence */
        <Alert variant="info" dismissible>
          This standing can still move: others can still sit this test. It settles once the test has
          closed for everyone.
        </Alert>
      ) : null}

      {card.isGraded ? null : (
        /* ui-copy-ok: consequence */
        <Alert variant="info" dismissible>
          This was a retake, so it is marked but it does not carry a rank.
        </Alert>
      )}

      <TileGrid>
        <StatTile label="Correct" value={card.correctCount} />
        <StatTile label="Wrong" value={card.wrongCount} />
        <StatTile label="Unattempted" value={card.unattemptedCount} />
        <StatTile label="Questions" value={card.totalQuestions} />
        <StatTile
          label="Time taken"
          value={minutes(card.timeTakenSec)}
          foot={`of ${minutes(card.durationSec)}`}
        />
      </TileGrid>

      <SurfaceCard
        title="Accuracy"
        meta={`${card.correctCount} right of ${plural(attempted, 'attempt')}`}
      >
        <Progress value={accuracy} aria-label="Accuracy" />
        <StatRow label="Percentage" value={`${card.percentage}%`} />
      </SurfaceCard>

      {report === null ? null : (
        <div className="grid items-start gap-4 lg:grid-cols-2">
          <DifficultyFigure difficulty={report.difficulty} />
          {curve === null ? null : <CohortFigure cohort={curve} />}
          <MarksFigure composition={report.composition} counts={paperCounts(report.sections)} />
          <TimeFigure
            time={report.time}
            counts={paperCounts(report.sections)}
            paceIndex={report.paceIndex}
          />
        </div>
      )}

      <Section title="Sections" meta={plural(card.sections.length, 'section')}>
        <DataTable
          columns={SECTION_COLUMNS}
          rows={card.sections}
          rowKey={(row) => row.baseConfigSectionId}
          isLoading={false}
          empty="This paper had no sections."
        />
      </Section>

      {trajectory.length > 1 ? <TrajectoryFigure trajectory={trajectory} /> : null}
    </PageBody>
  );
}

/** The percentile said in people, which is the way a student actually reads it. */
function beaten(card: ScoreCard): string {
  if (card.rank === null || card.cohortSize === null) return 'percentile';
  return `percentile · better than ${card.cohortSize - card.rank} of ${card.cohortSize}`;
}

/** Seconds read as minutes on a result screen; nobody counts a paper in seconds. */
function minutes(seconds: number): string {
  const whole = Math.floor(seconds / 60);
  return whole === 0 ? `${seconds}s` : `${whole}m`;
}
