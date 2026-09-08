import {
  Alert,
  ChartFigure,
  DonutPlot,
  MeasureBars,
  Metric,
  LinePlot,
  QuadrantPlot,
  cn,
  plural,
  type CompositionSegment,
  type LinePoint,
  type MeasureBar,
  type QuadrantPoint,
} from '@iace/ui';
import {
  SUBJECT_SAMPLE_FLOOR,
  measureOf,
  percentLabel,
  type Disposition,
  type EvaluationMode,
  type PerformancePoint,
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
  /** How wide the caller lays it out; a scatter needs more of a row than a bar list does. */
  className?: string;
}

/** What the toggle moves, summed off the subject rows that key on the mode. */
export function ModeTiles({ measure }: Readonly<{ measure: SubjectMeasure }>) {
  return (
    <div className="flex items-start gap-6">
      <Metric size="sm" label="Time on questions" value={spent(measure.sumTimeSec)} />
      <Metric
        size="sm"
        label="Pace"
        value={measure.pace === null ? UNMEASURED : `${Math.round(measure.pace)}s`}
        unit="per question"
      />
      <Metric
        size="sm"
        label="Accuracy"
        value={percentLabel(measure.accuracy, UNMEASURED)}
        unit={`of ${measure.attempted}`}
      />
    </div>
  );
}

/** Sitting by sitting, what share of the paper they took away — the one line that says if it works. */
export function ScoreTrendFigure({
  points,
  className,
}: Readonly<{ points: readonly PerformancePoint[]; className?: string }>) {
  const line: LinePoint[] = points.map((point) => ({
    key: point.attemptId,
    label: point.testTitle ?? 'Untitled test',
    value: Math.round(point.percentage),
    display: `${Math.round(point.percentage)}%`,
    caption: `Attempt ${point.attemptNo} · ${point.score} of ${point.maxMarks}`,
  }));
  const latest = line.at(-1);

  return (
    <ChartFigure
      title="Score"
      meta={plural(line.length, 'sitting')}
      figure={<Metric size="sm" label="Latest" value={latest?.display ?? UNMEASURED} />}
      className={cn('min-w-0', className)}
    >
      {line.length < 2 ? (
        <NoTrend sittings={line.length} />
      ) : (
        <LinePlot
          points={line}
          height={PLOT_HEIGHT}
          suffix="%"
          ticks={[0, 25, 50, 75, 100]}
          aria-label="Score as a share of the paper, sitting by sitting"
        />
      )}
    </ChartFigure>
  );
}

/** Nothing sat and one sitting are different facts: only one of them is asking for a retake. */
const NoTrend = ({ sittings }: Readonly<{ sittings: number }>) =>
  sittings === 0 ? (
    <Alert variant="info">No sitting in this mode has been marked yet.</Alert>
  ) : (
    /* ui-copy-ok: rule */
    <Alert variant="info">One sitting is a dot, not a trend. Sit the paper again.</Alert>
  );

/** Minutes once there is a minute to show; below that the seconds are the honest number. */
function spent(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const whole = Math.round(seconds / 60);
  return whole < 60 ? `${whole}m` : `${Math.round(whole / 60)}h`;
}

/** LIFETIME: no per-mode unattempted exists to bind it to, so the toggle must not seem to. */
export function DispositionFigure({
  disposition,
  className,
}: Readonly<{ disposition: Disposition; className?: string }>) {
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
      className={cn('min-w-0', className)}
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
export function SubjectStrengthFigure({ subjects, mode, scope, className }: Readonly<SubjectView>) {
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
      className={cn('min-w-0', className)}
    >
      {bars.length === 0 ? <NothingMeasured /> : <MeasureBars bars={bars} max={100} />}
    </ChartFigure>
  );
}

/** Where each subject sits against the median of the reader's OWN subjects, never a cohort's. */
export function SpeedAccuracyFigure({ subjects, mode, scope, className }: Readonly<SubjectView>) {
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
      className={cn('min-w-0', className)}
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
