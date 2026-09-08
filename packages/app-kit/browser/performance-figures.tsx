import {
  Alert,
  ChartFigure,
  ColumnPlot,
  CompositionBar,
  DistributionPlot,
  DivergingBars,
  LinePlot,
  Metric,
  StatRow,
  plural,
  type CompositionSegment,
  type DistributionMarker,
  type DivergingItem,
  type LinePoint,
  type PlotColumn,
} from '@iace/ui';
import {
  DIFFICULTY_LABELS,
  type CohortCurve,
  type DifficultyLevel,
  type DifficultyStanding,
  type MarkComposition,
  type PaperCounts,
  type PercentilePoint,
  type SectionalStanding,
  type TimeUse,
  percentLabel,
} from '@iace/contracts';

const UNMEASURED = '—';
const SECONDS_PER_MINUTE = 60;

const PLOT_HEIGHT = 280;
const COLUMN_HEIGHT = 320;

/** A band the wire named but no level covers keeps its own name rather than reading as unknown. */
const difficultyLabel = (name: string) => DIFFICULTY_LABELS[name as DifficultyLevel] ?? name;

const minutes = (seconds: number) =>
  seconds < SECONDS_PER_MINUTE
    ? `${Math.round(seconds)}s`
    : `${Math.round(seconds / SECONDS_PER_MINUTE)} min`;

/** Percentile across every sitting the scope holds — marks would be comparing two papers. */
export function TrajectoryFigure({
  trajectory,
}: Readonly<{ trajectory: readonly PercentilePoint[] }>) {
  const points: LinePoint[] = trajectory.map((point) => ({
    key: point.attemptId,
    label: point.testTitle ?? 'Untitled test',
    value: point.percentile,
    display: point.percentile === null ? UNMEASURED : String(point.percentile),
    caption: standingOf(point),
  }));
  const latest = [...points].reverse().find((point) => point.value !== null);

  return (
    <ChartFigure
      title="Percentile"
      meta={plural(trajectory.length, 'sitting')}
      figure={<Metric size="md" label="Latest" value={latest?.value ?? UNMEASURED} />}
    >
      <LinePlot
        points={points}
        height={PLOT_HEIGHT}
        ticks={[0, 25, 50, 75, 100]}
        aria-label="Percentile across the sittings in scope"
      />
    </ChartFigure>
  );
}

const standingOf = (point: PercentilePoint) => {
  if (point.rank === null) return undefined;
  return point.cohortSize === null
    ? `Rank ${point.rank}`
    : `Rank ${point.rank} of ${point.cohortSize}`;
};

/** Where this sitting fell on the curve the cohort drew. Only ever one paper's. */
export function CohortFigure({
  cohort,
  youLabel = 'You',
}: Readonly<{ cohort: CohortCurve; youLabel?: string }>) {
  const markers: DistributionMarker[] = [
    { key: 'you', label: youLabel, value: cohort.score, tone: 'you' },
  ];
  if (cohort.averageScore !== null) {
    markers.push({
      key: 'average',
      label: 'Average',
      value: cohort.averageScore,
      tone: 'neutral',
    });
  }
  if (cohort.topperScore !== null) {
    markers.push({ key: 'topper', label: 'Topper', value: cohort.topperScore, tone: 'good' });
  }

  return (
    <ChartFigure
      title="Standing"
      meta={plural(cohort.cohortSize, 'sitting')}
      figure={
        <Metric
          size="md"
          label="Rank"
          value={cohort.rank === null ? UNMEASURED : `#${cohort.rank}`}
          unit={cohort.cohortSize > 0 ? `of ${cohort.cohortSize}` : undefined}
        />
      }
    >
      <DistributionPlot
        height={PLOT_HEIGHT}
        bands={cohort.bands}
        markers={markers}
        min={cohort.bands[0]?.from ?? 0}
        max={cohort.bands.at(-1)?.to ?? cohort.score}
        axisSuffix="marks"
        countLabel="Sittings"
        aria-label="Where this sitting sits in the spread of scores"
      />
    </ChartFigure>
  );
}

/** What the crowd and the best of it did with the same paper, read under the reader's own bar. */
export interface Benchmark {
  average: number | null;
  topper: number | null;
}

/** Three values on one line: a comparison is taken in at a glance or it is not taken in. */
function BenchmarkRow({
  mine,
  benchmark,
  format,
}: Readonly<{ mine: number; benchmark: Benchmark; format: (value: number) => string }>) {
  const rows = [
    { key: 'you', label: 'You', value: format(mine) },
    { key: 'average', label: 'Average', value: at(benchmark.average, format) },
    { key: 'topper', label: 'Topper', value: at(benchmark.topper, format) },
  ];

  return (
    <div className="flex flex-wrap gap-x-6 gap-y-1 border-t border-border pt-3">
      {rows.map((row) => (
        <span key={row.key} className="flex items-baseline gap-1.5 text-sm">
          <span className="text-muted-foreground">{row.label}</span>
          <span className="font-medium tabular-nums text-foreground">{row.value}</span>
        </span>
      ))}
    </div>
  );
}

const at = (value: number | null, format: (value: number) => string) =>
  value === null ? UNMEASURED : format(value);

/** The three shares partition the paper's marks; the penalty is charged out of what was earned. */
export function MarksFigure({
  composition,
  counts,
  benchmark,
}: Readonly<{ composition: MarkComposition; counts: PaperCounts; benchmark?: Benchmark }>) {
  const segments: CompositionSegment[] = [
    {
      key: 'earned',
      label: 'Earned',
      value: composition.earned,
      display: `+${composition.earned}`,
      tone: 'positive',
    },
    {
      key: 'wrong',
      label: 'Lost on wrong answers',
      value: composition.lostToWrong,
      display: `−${composition.lostToWrong}`,
      tone: 'negative',
    },
    {
      key: 'blank',
      label: 'Left blank',
      value: composition.lostToUnanswered,
      display: String(composition.lostToUnanswered),
      tone: 'neutral',
    },
  ];

  return (
    <ChartFigure
      title="Marks"
      meta={`${counts.correct} correct · ${counts.wrong} wrong · ${counts.unattempted} left · penalty −${composition.penalty}`}
      figure={
        <Metric size="md" label="Net" value={composition.net} unit={`/ ${composition.maxMarks}`} />
      }
    >
      <CompositionBar segments={segments} aria-label="Where this sitting's marks came from" />
      {benchmark ? (
        <BenchmarkRow mine={composition.net} benchmark={benchmark} format={String} />
      ) : null}
    </ChartFigure>
  );
}

/** Section score minus the cohort's mean, so the middle of the plot is the crowd. */
export function SectionsFigure({ sections }: Readonly<{ sections: readonly SectionalStanding[] }>) {
  const items: DivergingItem[] = sections.map((section) => ({
    key: section.baseConfigSectionId,
    label: section.name,
    value:
      section.cohortAverageScore === null
        ? null
        : round(section.score - section.cohortAverageScore),
    caption: sectionCaption(section),
  }));

  // Without a cohort every delta is null, so the axis would draw nothing the reader can use.
  const compared = items.some((item) => item.value !== null);

  return (
    <ChartFigure title="Sections" meta={plural(sections.length, 'section')}>
      {compared ? (
        <DivergingBars
          items={items}
          belowLabel="Below average"
          aboveLabel="Above average"
          aria-label="Each section's marks against the average"
        />
      ) : (
        <div className="flex flex-col gap-3">
          <Alert variant="info">No average has been counted for this paper yet.</Alert>
          <div className="flex flex-col gap-2">
            {sections.map((section) => (
              <StatRow
                key={section.baseConfigSectionId}
                label={section.name}
                value={`${section.score} of ${section.maxMarks}`}
              />
            ))}
          </div>
        </div>
      )}
    </ChartFigure>
  );
}

/** Their clock beside the two the rollup now carries: what the field spent here, and the topper. */
function sectionCaption(section: SectionalStanding): string {
  const held = [`${section.score} of ${section.maxMarks}`, minutes(section.timeSpentSec)];
  if (section.cohortAverageTimeSec !== null) {
    held.push(`cohort ${minutes(section.cohortAverageTimeSec)}`);
  }
  if (section.topperTimeSec !== null) held.push(`topper ${minutes(section.topperTimeSec)}`);
  return held.join(' · ');
}

/** Accuracy per band, with the cohort's own p-value ticked across it on the same scale. */
export function DifficultyFigure({
  difficulty,
}: Readonly<{ difficulty: readonly DifficultyStanding[] }>) {
  const columns: PlotColumn[] = difficulty.map((band) => ({
    key: band.key,
    label: difficultyLabel(band.name),
    value: band.accuracy,
    display: percentLabel(band.accuracy, UNMEASURED),
    meta: `${band.attempted} of ${band.total}`,
    marker: band.cohortPValue === null ? null : round(band.cohortPValue * 100),
    markerDisplay:
      band.cohortPValue === null ? undefined : `Cohort ${round(band.cohortPValue * 100)}%`,
  }));
  const attempted = difficulty.reduce((sum, band) => sum + band.attempted, 0);
  const total = difficulty.reduce((sum, band) => sum + band.total, 0);

  return (
    <ChartFigure title="Difficulty" meta={`${attempted} of ${total} attempted`}>
      <ColumnPlot
        columns={columns}
        height={COLUMN_HEIGHT}
        suffix="%"
        aria-label="Accuracy by difficulty band, against the average"
      />
    </ChartFigure>
  );
}

/** Reconstructed from the means and the counts, so the shares are of the SAME clock as the total. */
export function TimeFigure({
  time,
  counts,
  paceIndex = null,
  benchmark,
}: Readonly<{
  time: TimeUse;
  counts: PaperCounts;
  paceIndex?: number | null;
  benchmark?: Benchmark;
}>) {
  const onCorrect = Math.round(time.avgOnCorrectSec * counts.correct);
  const onWrong = Math.round(time.avgOnWrongSec * counts.wrong);
  const rest = Math.max(0, time.totalSec - onCorrect - onWrong - time.spentOnUnattemptedSec);

  const segments: CompositionSegment[] = [
    {
      key: 'correct',
      label: 'On right answers',
      value: onCorrect,
      display: minutes(onCorrect),
      tone: 'positive',
    },
    {
      key: 'wrong',
      label: 'On wrong answers',
      value: onWrong,
      display: minutes(onWrong),
      tone: 'negative',
    },
    {
      key: 'left',
      label: 'On questions left',
      value: time.spentOnUnattemptedSec,
      display: minutes(time.spentOnUnattemptedSec),
      tone: 'neutral',
    },
  ];
  if (rest > 0) {
    segments.push({
      key: 'rest',
      label: 'Unscored',
      value: rest,
      display: minutes(rest),
      tone: 'neutral',
    });
  }

  return (
    <ChartFigure
      title="Time"
      meta={`${minutes(time.avgPerQuestionSec)} per question`}
      figure={
        <div className="flex items-start gap-6">
          <Metric size="md" label="Total" value={minutes(time.totalSec)} />
          {paceIndex === null ? null : (
            <Metric
              size="md"
              label="Pace"
              value={paceIndex}
              unit={paceIndex > 1 ? 'slower' : 'faster'}
            />
          )}
        </div>
      }
    >
      <CompositionBar segments={segments} aria-label="How the clock was spent" />
      {benchmark ? (
        <BenchmarkRow mine={time.totalSec} benchmark={benchmark} format={minutes} />
      ) : null}
    </ChartFigure>
  );
}

const round = (value: number) => Math.round(value * 100) / 100;
