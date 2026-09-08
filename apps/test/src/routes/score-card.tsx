import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Info } from 'lucide-react';
import { Badge, Button, Metric, Tooltip, TooltipContent, TooltipTrigger, cn } from '@iace/ui';
import {
  CohortFigure,
  MarksFigure,
  TimeFigure,
  TrajectoryFigure,
  type Benchmark,
} from '@iace/app-kit/browser';
import {
  EVALUATION_MODE,
  EVALUATION_MODE_LABELS,
  PERFORMANCE_SCOPES,
  paperCounts,
  type CohortCurve,
  type EvaluationMode,
  type PerformanceReport,
  type ScoreCard,
  type SectionalStanding,
} from '@iace/contracts';
import { api } from '../lib/api';
import { performanceReportQueryKey, scoreCardQueryKey } from '../lib/constants';
import { Hero, HeroFigure, PageBody, ReportSkeleton, StatTile, TileGrid } from '../components/ui';

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

  if (card.isLoading) return <ReportSkeleton />;
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
        figure={<Headline card={card} />}
        aside={<Beside card={card} accuracy={accuracy} />}
        corner={<Corner card={card} mode={report?.evaluationMode ?? null} />}
      />

      <TileGrid className="lg:grid-cols-6 xl:grid-cols-6">
        <StatTile label="Correct" value={card.correctCount} />
        <StatTile label="Wrong" value={card.wrongCount} />
        <StatTile label="Unattempted" value={card.unattemptedCount} />
        <StatTile label="Questions" value={card.totalQuestions} />
        <StatTile label="Percentage" value={card.percentage} unit="%" />
        <StatTile
          label="Time taken"
          value={minutes(card.timeTakenSec)}
          foot={`of ${minutes(card.durationSec)}`}
        />
      </TileGrid>

      {report === null ? null : (
        <div className={cn('grid items-start gap-4', curve === null ? null : 'lg:grid-cols-2')}>
          {/* Marks and Time read as one column against the crowd standing beside them. */}
          <div className="flex min-w-0 flex-col gap-4">
            <MarksFigure
              composition={report.composition}
              counts={paperCounts(report.sections)}
              benchmark={marksAgainst(curve)}
            />
            <TimeFigure
              time={report.time}
              counts={paperCounts(report.sections)}
              paceIndex={report.paceIndex}
              benchmark={timeAgainst(report.sections)}
            />
          </div>
          {curve === null ? null : <CohortFigure cohort={curve} />}
        </div>
      )}

      {trajectory.length > 1 ? <TrajectoryFigure trajectory={trajectory} /> : null}
    </PageBody>
  );
}

/** What the paper IS, and what qualifies the figures — out of the way of the number itself. */
function Corner({ card, mode }: Readonly<{ card: ScoreCard; mode: EvaluationMode | null }>) {
  const notices = noticesFor(card);

  return (
    <>
      {mode === null ? null : (
        <Badge variant={mode === EVALUATION_MODE.RANKED ? 'primary' : 'neutral'}>
          {EVALUATION_MODE_LABELS[mode]}
        </Badge>
      )}

      {notices.length === 0 ? null : (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon">
              <Info aria-hidden />
              <span className="sr-only">About this result</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs">
            <span className="flex flex-col gap-2">
              {notices.map((notice) => (
                <span key={notice}>{notice}</span>
              ))}
            </span>
          </TooltipContent>
        </Tooltip>
      )}
    </>
  );
}

/** Each one is a CONSEQUENCE the figures cannot show: what can still move it, and what it misses. */
function noticesFor(card: ScoreCard): string[] {
  const notices: string[] = [];
  if (card.provisional) {
    notices.push(
      'This standing can still move: others can still sit this test. It settles once the test has closed for everyone.',
    );
  }
  if (!card.isGraded) {
    notices.push('This was a retake, so it is marked but it does not carry a rank.');
  }
  return notices;
}

/** An unranked sitting has no percentile to lead with, so its marks take the headline instead. */
function Headline({ card }: Readonly<{ card: ScoreCard }>) {
  if (card.percentile === null) {
    return <HeroFigure value={card.score} unit={`/ ${card.maxMarks}`} caption="marks" />;
  }
  return <HeroFigure value={card.percentile} unit="th" caption={beaten(card)} />;
}

/** Never the figure twice: what leads the hero is dropped from what stands beside it. */
function Beside({ card, accuracy }: Readonly<{ card: ScoreCard; accuracy: number }>) {
  return (
    <>
      {card.percentile === null ? null : (
        <Metric
          label="Rank"
          value={card.rank ?? '—'}
          unit={
            card.rank === null || card.cohortSize === null ? undefined : `of ${card.cohortSize}`
          }
          size="md"
        />
      )}
      {card.percentile === null ? null : (
        <Metric label="Marks" value={card.score} unit={`/ ${card.maxMarks}`} size="md" />
      )}
      <Metric label="Accuracy" value={accuracy} unit="%" size="md" />
    </>
  );
}

/** The percentile said in people, which is the way a student actually reads it. */
function beaten(card: ScoreCard): string {
  if (card.rank === null || card.cohortSize === null) return 'percentile';
  return `percentile · better than ${card.cohortSize - card.rank} of ${card.cohortSize}`;
}

/** The paper's own marks against the crowd's — the two figures a result is actually read against. */
const marksAgainst = (curve: CohortCurve | null) =>
  curve === null ? undefined : { average: curve.averageScore, topper: curve.topperScore };

/** The topper's clock is only ever known per SECTION, so their paper is the sum of those. */
function timeAgainst(sections: readonly SectionalStanding[]): Benchmark | undefined {
  const measured = sections.filter((section) => section.topperTimeSec !== null);
  if (measured.length === 0) return undefined;

  return {
    average: sumOrNull(sections.map((section) => section.cohortAverageTimeSec)),
    topper: measured.reduce((total, section) => total + (section.topperTimeSec ?? 0), 0),
  };
}

/** One unmeasured section makes the total a guess, so the whole comparison stands down. */
function sumOrNull(values: readonly (number | null)[]): number | null {
  if (values.includes(null)) return null;
  return values.reduce((total: number, value) => total + (value ?? 0), 0);
}

/** Seconds read as minutes on a result screen; nobody counts a paper in seconds. */
function minutes(seconds: number): string {
  const whole = Math.floor(seconds / 60);
  return whole === 0 ? `${seconds}s` : `${whole}m`;
}
