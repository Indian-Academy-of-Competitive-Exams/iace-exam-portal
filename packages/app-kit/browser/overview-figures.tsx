import {
  Alert,
  ChartFigure,
  DonutPlot,
  MeasureBars,
  Metric,
  QuadrantPlot,
  plural,
  type CompositionSegment,
  type MeasureBar,
  type QuadrantPoint,
} from '@iace/ui';
import {
  SUBJECT_SAMPLE_FLOOR,
  measureOf,
  percentLabel,
  type Disposition,
  type EvaluationMode,
  type SubjectMeasure,
  type SubjectStanding,
  type TestScope,
} from '@iace/contracts';

const UNMEASURED = '—';
const PLOT_HEIGHT = 300;

/** Which mode and scope a subject figure is being read in. Both are the reader's own choice. */
export interface SubjectView {
  subjects: readonly SubjectStanding[];
  mode: EvaluationMode;
  /** Null is every scope summed, which is what the subject charts open on. */
  scope: TestScope | null;
}

/** The only two tiles the toggle moves, summed off the subject rows that key on the mode. */
export function ModeTiles({ measure }: Readonly<{ measure: SubjectMeasure }>) {
  return (
    <div className="flex items-start gap-6">
      <Metric
        size="sm"
        label="Accuracy"
        value={percentLabel(measure.accuracy, UNMEASURED)}
        unit={`of ${measure.attempted}`}
      />
      <Metric
        size="sm"
        label="Pace"
        value={measure.pace === null ? UNMEASURED : `${Math.round(measure.pace)}s`}
        unit="per question"
      />
    </div>
  );
}

/** LIFETIME: no per-mode unattempted exists to bind it to, so the toggle must not seem to. */
export function DispositionFigure({ disposition }: Readonly<{ disposition: Disposition }>) {
  const total = disposition.correct + disposition.wrong + disposition.unattempted;
  const segments: CompositionSegment[] = [
    { key: 'correct', label: 'Correct', value: disposition.correct, tone: 'positive' },
    { key: 'wrong', label: 'Wrong', value: disposition.wrong, tone: 'negative' },
    { key: 'left', label: 'Unattempted', value: disposition.unattempted, tone: 'neutral' },
  ];

  return (
    <ChartFigure
      title="Questions"
      meta={`${total} across every sitting, ranked and practice`}
      className="min-w-0"
    >
      <DonutPlot
        segments={segments}
        centre={{
          value: percentLabel(total === 0 ? null : (disposition.correct / total) * 100, UNMEASURED),
          label: 'Correct',
        }}
        aria-label="Correct, wrong and unattempted across every sitting"
      />
    </ChartFigure>
  );
}

/** Strongest to weakest, each bar carrying the n it was measured over. No cohort, so no rank. */
export function SubjectStrengthFigure({ subjects, mode, scope }: Readonly<SubjectView>) {
  const measured = measuredSubjects(subjects, mode, scope).sort(
    (a, b) => (b.measure.accuracy ?? 0) - (a.measure.accuracy ?? 0),
  );

  const bars: MeasureBar[] = measured.map(({ subject, measure }) => ({
    key: subject.subjectId,
    label: subject.name,
    value: measure.accuracy ?? 0,
    display: percentLabel(measure.accuracy, UNMEASURED),
    meta: `of ${measure.attempted}`,
    faint: measure.attempted < SUBJECT_SAMPLE_FLOOR,
  }));

  return (
    <ChartFigure
      title="Subject accuracy"
      meta={plural(measured.length, 'subject')}
      className="min-w-0"
    >
      {bars.length === 0 ? <NothingMeasured /> : <MeasureBars bars={bars} max={100} />}
    </ChartFigure>
  );
}

/** Where each subject sits against the median of the reader's OWN subjects, never a cohort's. */
export function SpeedAccuracyFigure({ subjects, mode, scope }: Readonly<SubjectView>) {
  const measured = measuredSubjects(subjects, mode, scope);
  const points: QuadrantPoint[] = measured.map(({ subject, measure }) => ({
    key: subject.subjectId,
    label: subject.name,
    x: Math.round(measure.pace ?? 0),
    y: Math.round(measure.accuracy ?? 0),
    weight: measure.attempted,
    faint: measure.attempted < SUBJECT_SAMPLE_FLOOR,
    caption: `of ${measure.attempted}`,
  }));

  return (
    <ChartFigure
      title="Speed and accuracy"
      meta={plural(points.length, 'subject')}
      className="min-w-0"
    >
      {points.length < 2 ? (
        <TooFewToPlot measured={points.length} />
      ) : (
        <QuadrantPlot
          points={points}
          xGuide={medianOf(points.map((point) => point.x))}
          yGuide={medianOf(points.map((point) => point.y))}
          quadrants={QUADRANTS}
          xSuffix="s"
          ySuffix="%"
          height={PLOT_HEIGHT}
          aria-label="Each subject's pace against its accuracy"
        />
      )}
    </ChartFigure>
  );
}

/** Fast is LEFT, because the x-axis is seconds per question: less time is further from the origin. */
const QUADRANTS = {
  lowXHighY: 'Fast and accurate',
  highXHighY: 'Slow and accurate',
  lowXLowY: 'Fast and inaccurate',
  highXLowY: 'Slow and inaccurate',
} as const;

interface MeasuredSubject {
  subject: SubjectStanding;
  measure: SubjectMeasure;
}

/** A subject with nothing attempted in this mode and scope has said nothing, so it is left out. */
function measuredSubjects(
  subjects: readonly SubjectStanding[],
  mode: EvaluationMode,
  scope: TestScope | null,
): MeasuredSubject[] {
  return subjects
    .map((subject) => ({ subject, measure: measureOf(subject.tallies, mode, scope) }))
    .filter(({ measure }) => measure.attempted > 0);
}

/** The middle reading, so half the subjects fall either side of the guide whatever the spread. */
function medianOf(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle] ?? 0;
  return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

const NothingMeasured = () => (
  <Alert variant="info">No question in this mode and scope has been marked yet.</Alert>
);

/** Nothing measured and one subject are different facts; a median needs two either way. */
const TooFewToPlot = ({ measured }: Readonly<{ measured: number }>) =>
  measured === 0 ? (
    <NothingMeasured />
  ) : (
    <Alert variant="info">One subject has no median to sit against. Sit a wider paper.</Alert>
  );
