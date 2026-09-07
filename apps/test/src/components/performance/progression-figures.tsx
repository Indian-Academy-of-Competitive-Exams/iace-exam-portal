import {
  AlignedPlots,
  Badge,
  ChartFigure,
  ColumnPlot,
  LinePlot,
  Metric,
  plural,
  type LinePoint,
  type PlotColumn,
  type SeriesSlot,
} from '@iace/ui';
import {
  type RampStep,
  type SeriesProgression,
  type SubjectMastery,
  percentLabel,
} from '@iace/contracts';
import { MASTERY_TREND_BADGE, MASTERY_TREND_LABELS, SERIES_SLOT_COUNT } from '../../lib/constants';

const UNMEASURED = '—';
const UNTITLED = 'Untitled test';
const PERCENTILE_TICKS = [0, 25, 50, 75, 100];

const RAMP_LINE_HEIGHT = 300;
const RAMP_COLUMN_HEIGHT = 330;
const SPARK_HEIGHT = 96;

/** Two plots on one x — a percentile line over the difficulty bars, never one dual-axis chart. */
export function RampFigure({ progression }: Readonly<{ progression: SeriesProgression }>) {
  const { steps } = progression;
  const climb = steps.map(percentileAt);
  const ramp = steps.map(difficultyAt);
  const latest = [...climb].reverse().find((point) => point.value !== null);

  return (
    <ChartFigure
      title="Percentile against difficulty"
      meta={`${plural(steps.length, 'test')} · percentile ${shift(spanOf(climb))} · difficulty ${shift(spanOf(ramp))}`}
      figure={<Metric size="sm" label="Latest" value={latest?.value ?? UNMEASURED} />}
    >
      <AlignedPlots
        secondaryLabel="Paper difficulty"
        primary={
          <LinePlot
            points={climb}
            align="bands"
            height={RAMP_LINE_HEIGHT}
            ticks={PERCENTILE_TICKS}
            xLabels={false}
            aria-label="Percentile on each test in the series order"
          />
        }
        secondary={
          <ColumnPlot
            columns={ramp}
            height={RAMP_COLUMN_HEIGHT}
            aria-label="How hard each paper's questions are graded"
          />
        }
      />
    </ChartFigure>
  );
}

const percentileAt = (step: RampStep): LinePoint => ({
  key: step.attemptId,
  label: step.title ?? UNTITLED,
  value: step.percentile,
  display: step.percentile === null ? UNMEASURED : String(step.percentile),
});

const difficultyAt = (step: RampStep): PlotColumn => ({
  key: step.testId,
  label: step.title ?? UNTITLED,
  value: step.difficulty,
  meta: plural(step.questionCount, 'question'),
});

/** One sparkline per subject over the same rungs, so a slide shows as a slide and not as a gap. */
export function MasteryFigure({ subjects }: Readonly<{ subjects: readonly SubjectMastery[] }>) {
  return (
    <ChartFigure title="Subject mastery" meta={plural(subjects.length, 'subject')}>
      <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
        {subjects.map((subject, index) => (
          <SubjectSpark key={subject.subjectId} subject={subject} slot={slotAt(index)} />
        ))}
      </div>
    </ChartFigure>
  );
}

function SubjectSpark({ subject, slot }: Readonly<{ subject: SubjectMastery; slot: SeriesSlot }>) {
  const points: LinePoint[] = subject.points.map((point, index) => ({
    key: `${subject.subjectId}-${point.testId}-${index}`,
    label: subject.subjectName,
    value: point.accuracy,
    display: point.accuracy === null ? UNMEASURED : percentLabel(point.accuracy),
    caption: plural(point.attempted, 'question'),
  }));

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-sm font-semibold text-foreground">
          {subject.subjectName}
        </span>
        <Badge variant={MASTERY_TREND_BADGE[subject.trend]}>
          {MASTERY_TREND_LABELS[subject.trend]}
        </Badge>
      </div>
      <span className="text-xs tabular-nums text-muted-foreground">{reading(subject)}</span>
      <LinePlot
        points={points}
        compact
        series={slot}
        height={SPARK_HEIGHT}
        aria-label={`${subject.subjectName} accuracy across the series`}
      />
    </div>
  );
}

/** Where the subject started and where it stands, never a bare arrow with nothing behind it. */
function reading(subject: SubjectMastery): string {
  if (subject.first === null || subject.last === null) return UNMEASURED;
  return `${subject.first}% → ${subject.last}%`;
}

const slotAt = (index: number) => (Math.min(index, SERIES_SLOT_COUNT - 1) + 1) as SeriesSlot;

interface Span {
  from: number;
  to: number;
}

function spanOf(points: readonly { value: number | null }[]): Span | null {
  const measured = points.flatMap((point) => (point.value === null ? [] : [point.value]));
  const from = measured.at(0);
  const to = measured.at(-1);
  return from === undefined || to === undefined ? null : { from, to };
}

function shift(span: Span | null): string {
  if (span === null) return UNMEASURED;
  const delta = Math.round(span.to - span.from);
  return delta > 0 ? `+${delta}` : String(delta);
}
