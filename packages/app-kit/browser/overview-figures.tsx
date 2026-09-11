import {
  Alert,
  ChartFigure,
  DonutPlot,
  MeasureBars,
  Metric,
  DivergingBars,
  LinePlot,
  QuadrantPlot,
  StatRow,
  cn,
  plural,
  type CompositionSegment,
  type DivergingItem,
  type LinePoint,
  type MeasureBar,
  type QuadrantPoint,
} from '@iace/ui';
import {
  SUBJECT_SAMPLE_FLOOR,
  dispositionRates,
  measureOf,
  percentLabel,
  rankSubjectsByWeakness,
  scopeComparison,
  scopesNotSat,
  subjectShares,
  untouchedSubjects,
  type Disposition,
  type EffortPerSitting,
  type PerformancePoint,
  type SubjectMeasure,
  type SubjectStanding,
  type TestScope,
  TEST_SCOPE_LABELS,
} from '@iace/contracts';

const UNMEASURED = '—';
const PLOT_HEIGHT = 300;
/** A subject's name is long where a section's is short: 'General Intelligence and Reasoning'. */
const SUBJECT_LABEL_WIDTH = 210;

/** Which scope a subject figure is being read in, which is the reader's own choice. */
export interface SubjectView {
  subjects: readonly SubjectStanding[];
  /** Null is every scope summed, which is what the subject charts open on. */
  scope: TestScope | null;
  /** How wide the caller lays it out; a scatter needs more of a row than a bar list does. */
  className?: string;
}

/** Time, pace and accuracy, summed off every subject row. */
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

/** A short paper proves knowledge; a long one proves it survives. This is the difference. */
export function ScopeGapFigure({
  subjects,
  className,
}: Readonly<{
  subjects: readonly SubjectStanding[];
  className?: string;
}>) {
  const compared = scopeComparison(subjects);
  const items: DivergingItem[] =
    compared?.subjects.map((row) => ({
      key: row.subjectId,
      label: row.name,
      value: row.accuracyGap === null ? null : Math.round(row.accuracyGap),
      caption: `${percentLabel(row.first.accuracy, UNMEASURED)} of ${row.first.attempted} · ${percentLabel(row.second.accuracy, UNMEASURED)} of ${row.second.attempted}`,
    })) ?? [];

  return (
    <ChartFigure
      title={
        compared === null ? 'Across kinds of paper' : titleFor(compared.first, compared.second)
      }
      meta={plural(items.length, 'subject')}
      className={cn('min-w-0', className)}
    >
      {compared === null ? (
        /* ui-copy-ok: rule */
        <Alert variant="info">
          Two kinds of paper are needed to compare them. Sit a second kind to see this.
        </Alert>
      ) : (
        <DivergingBars
          items={items}
          labelWidth={SUBJECT_LABEL_WIDTH}
          belowLabel={`Weaker on ${TEST_SCOPE_LABELS[compared.first].toLowerCase()}`}
          aboveLabel={`Stronger on ${TEST_SCOPE_LABELS[compared.first].toLowerCase()}`}
          aria-label="Each subject's accuracy on one kind of paper against another"
        />
      )}
    </ChartFigure>
  );
}

const titleFor = (first: TestScope, second: TestScope) =>
  `${TEST_SCOPE_LABELS[first]} against ${TEST_SCOPE_LABELS[second].toLowerCase()}`;

/** A subject a paper asked about and never got an answer to, and a kind of paper never sat. */
export function BlindSpots({
  subjects,
  scope,
}: Readonly<{
  subjects: readonly SubjectStanding[];
  scope: TestScope | null;
}>) {
  const untouched = untouchedSubjects(subjects, scope);
  const missing = scopesNotSat(subjects);
  if (untouched.length === 0 && missing.length === 0) return null;

  return (
    /* ui-copy-ok: consequence */
    <Alert variant="warning">
      {untouched.length > 0
        ? `Served and never answered: ${untouched.map((subject) => subject.name).join(', ')}. `
        : ''}
      {missing.length > 0
        ? `Never sat: ${missing.map((value) => TEST_SCOPE_LABELS[value].toLowerCase()).join(', ')}.`
        : ''}
    </Alert>
  );
}

/** Nothing sat and one sitting are different facts: only one of them is asking for a retake. */
const NoTrend = ({ sittings }: Readonly<{ sittings: number }>) =>
  sittings === 0 ? (
    <Alert variant="info">No sitting has been marked yet.</Alert>
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

/** LIFETIME: no per-scope unattempted exists, so it ignores the scope the other figures read. */
export function DispositionFigure({
  disposition,
  effort,
  className,
}: Readonly<{ disposition: Disposition; effort?: EffortPerSitting; className?: string }>) {
  const rates = dispositionRates(disposition);
  const total = rates.served;
  const segments: CompositionSegment[] = [
    { key: 'correct', label: 'Correct', value: disposition.correct, tone: 'positive' },
    { key: 'wrong', label: 'Wrong', value: disposition.wrong, tone: 'negative' },
    { key: 'left', label: 'Unattempted', value: disposition.unattempted, tone: 'neutral' },
  ];

  return (
    <ChartFigure
      title="Questions"
      meta={`${total} across every sitting`}
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
      <div className="flex flex-col gap-1 border-t border-border pt-3">
        <StatRow label="Attempted" value={percentLabel(rates.attemptRate, UNMEASURED)} />
        <StatRow label="Correct of answered" value={percentLabel(rates.accuracy, UNMEASURED)} />
        <StatRow label="Wrong of answered" value={percentLabel(rates.errorRate, UNMEASURED)} />
        {effort === undefined ? null : (
          <>
            <StatRow label="Questions a sitting" value={effort.questions ?? UNMEASURED} />
            <StatRow
              label="Time a sitting"
              value={effort.timeSec === null ? UNMEASURED : spent(effort.timeSec)}
            />
            <StatRow
              label="Time a question served"
              value={effort.perServedSec === null ? UNMEASURED : `${effort.perServedSec}s`}
            />
          </>
        )}
      </div>
    </ChartFigure>
  );
}

/** Share of the marks minus share of the clock: below the line a subject is not paying its way. */
export function TimeReturnFigure({ subjects, scope, className }: Readonly<SubjectView>) {
  const shares = subjectShares(subjects, scope).filter((share) => share.sumTimeSec > 0);
  const items: DivergingItem[] = shares.map((share) => ({
    key: share.subjectId,
    label: share.name,
    value: Math.round(share.payoff),
    caption: `${spent(share.sumTimeSec)} and ${share.correct} right · ${Math.round(share.attemptedShare)}% of answers, ${Math.round(share.timeShare)}% of clock, ${Math.round(share.correctShare)}% of marks`,
  }));

  return (
    <ChartFigure
      title="Time against return"
      meta={plural(items.length, 'subject')}
      className={cn('min-w-0', className)}
    >
      {items.length === 0 ? (
        <NothingMeasured />
      ) : (
        <DivergingBars
          items={items}
          labelWidth={SUBJECT_LABEL_WIDTH}
          belowLabel="Takes more than it gives"
          aboveLabel="Gives more than it takes"
          aria-label="Each subject's share of correct answers against its share of the clock"
        />
      )}
    </ChartFigure>
  );
}

/** Strongest to weakest, each bar carrying the n it was measured over. No cohort, so no rank. */
export function SubjectStrengthFigure({ subjects, scope, className }: Readonly<SubjectView>) {
  const measured = measuredSubjects(subjects, scope).sort(
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

/** Ranked, so five is the read and a sixth is noise: past that it is the accuracy chart again. */
const WEAKEST_SHOWN = 5;

/** Weakest first, off the pre-folded rows. Insight only: it offers no paper, and cannot. */
export function WeakestSubjectsFigure({ subjects, scope, className }: Readonly<SubjectView>) {
  const ranking = rankSubjectsByWeakness(subjects, scope);
  const shown = ranking.weakest.slice(0, WEAKEST_SHOWN);

  const bars: MeasureBar[] = shown.map((row) => ({
    key: row.subjectId,
    label: row.name,
    value: row.measure.accuracy ?? 0,
    display: percentLabel(row.measure.accuracy, UNMEASURED),
    meta: `of ${row.measure.attempted}`,
  }));

  return (
    <ChartFigure
      title="Weakest subjects"
      meta={plural(ranking.weakest.length, 'subject')}
      className={cn('min-w-0', className)}
    >
      {bars.length === 0 ? <NothingRanked thin={ranking.thin.length} /> : null}
      {bars.length > 0 ? <MeasureBars bars={bars} max={100} /> : null}
      {bars.length > 0 && ranking.thin.length > 0 ? (
        /* ui-copy-ok: rule */
        <Alert variant="info">
          Not enough data yet on {ranking.thin.map((row) => row.name).join(', ')} — a subject is
          ranked once {SUBJECT_SAMPLE_FLOOR} of its questions have been marked.
        </Alert>
      ) : null}
    </ChartFigure>
  );
}

/** Nothing over the floor yet is not the same fact as nothing answered at all. */
const NothingRanked = ({ thin }: Readonly<{ thin: number }>) =>
  thin === 0 ? (
    <NothingMeasured />
  ) : (
    /* ui-copy-ok: rule */
    <Alert variant="info">
      No subject has {SUBJECT_SAMPLE_FLOOR} marked questions behind it yet, so none is ranked.
    </Alert>
  );

/** Where each subject sits against the median of the reader's OWN subjects, never a cohort's. */
export function SpeedAccuracyFigure({ subjects, scope, className }: Readonly<SubjectView>) {
  const measured = measuredSubjects(subjects, scope);
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

/** A subject with nothing attempted in this scope has said nothing, so it is left out. */
function measuredSubjects(
  subjects: readonly SubjectStanding[],
  scope: TestScope | null,
): MeasuredSubject[] {
  return subjects
    .map((subject) => ({ subject, measure: measureOf(subject.tallies, scope) }))
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
  <Alert variant="info">No question in this scope has been marked yet.</Alert>
);

/** Nothing measured and one subject are different facts; a median needs two either way. */
const TooFewToPlot = ({ measured }: Readonly<{ measured: number }>) =>
  measured === 0 ? (
    <NothingMeasured />
  ) : (
    <Alert variant="info">One subject has no median to sit against. Sit a wider paper.</Alert>
  );
