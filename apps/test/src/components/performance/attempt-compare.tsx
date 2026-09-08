import { Info } from 'lucide-react';
import {
  Alert,
  ChartFigure,
  ComparisonCards,
  LinePlot,
  SectionHeading,
  plural,
  type ComparisonItem,
  type CompositionSegment,
  type LinePoint,
  type PlotReference,
} from '@iace/ui';
import {
  INSTITUTE_TIME_ZONE,
  bestSitting,
  type CohortCurve,
  type PerformancePoint,
  percentLabel,
} from '@iace/contracts';

const RETAKE_HEIGHT = 300;

const WHEN = new Intl.DateTimeFormat('en-IN', {
  timeZone: INSTITUTE_TIME_ZONE,
  dateStyle: 'medium',
});

const sat = (at: string | null) => (at === null ? undefined : WHEN.format(new Date(at)));

/** Marks won against marks forgone — the one bar all three cards can honestly be read on. */
function marksAgainst(score: number, maxMarks: number): CompositionSegment[] {
  const won = Math.max(score, 0);
  return [
    { key: 'won', label: 'Marks', value: won, display: String(score), tone: 'positive' },
    { key: 'rest', label: 'Forgone', value: Math.max(maxMarks - won, 0), tone: 'neutral' },
  ];
}

/** A practice paper stands against what does mean something: your best, the average, the topper. */
export function AttemptCompare({
  sittings,
  cohort,
}: Readonly<{ sittings: readonly PerformancePoint[]; cohort: CohortCurve | null }>) {
  const latest = sittings.at(-1);
  const best = bestSitting(sittings);
  if (!latest || !best) return null;

  const items: ComparisonItem[] = [
    {
      key: 'latest',
      label: 'This attempt',
      meta: sat(latest.submittedAt),
      value: latest.score,
      max: latest.maxMarks,
      display: String(latest.score),
      segments: marksAgainst(latest.score, latest.maxMarks),
      caption: `${percentLabel(latest.percentage)} · ${percentLabel(latest.accuracy)} accuracy`,
      tone: 'current',
    },
    {
      key: 'best',
      label: 'Your best',
      meta: sat(best.submittedAt),
      value: best.score,
      max: best.maxMarks,
      display: String(best.score),
      segments: marksAgainst(best.score, best.maxMarks),
      caption: `${percentLabel(best.percentage)} · ${percentLabel(best.accuracy)} accuracy`,
    },
  ];

  // A practice paper is not ranked, but everyone who sat it still averages to something.
  if (cohort?.averageScore != null) {
    items.push({
      key: 'average',
      label: 'Average',
      value: cohort.averageScore,
      max: latest.maxMarks,
      display: String(cohort.averageScore),
      segments: marksAgainst(cohort.averageScore, latest.maxMarks),
      caption: plural(cohort.cohortSize, 'sitting'),
    });
  }

  if (cohort?.topperScore != null) {
    items.push({
      key: 'topper',
      label: 'Paper topper',
      value: cohort.topperScore,
      max: latest.maxMarks,
      display: String(cohort.topperScore),
      segments: marksAgainst(cohort.topperScore, latest.maxMarks),
      caption: plural(cohort.cohortSize, 'sitting'),
      tone: 'good',
    });
  }

  return (
    <div className="flex flex-col gap-8">
      <Alert variant="info">
        <Info />
        <span>
          A practice paper is not ranked. It is measured against your own best, the average across
          the test, and the paper topper where one is on record.
        </span>
      </Alert>

      <section className="flex flex-col gap-3">
        <SectionHeading title="Attempts" />
        <ComparisonCards items={items} />
      </section>

      <RetakeFigure sittings={sittings} cohort={cohort} />
    </div>
  );
}

/** Retakes in marks, against the topper — the one place marks compare, because it is one paper. */
function RetakeFigure({
  sittings,
  cohort,
}: Readonly<{ sittings: readonly PerformancePoint[]; cohort: CohortCurve | null }>) {
  const maxMarks = sittings.at(-1)?.maxMarks ?? 0;
  const points: LinePoint[] = sittings.map((sitting, index) => ({
    key: sitting.attemptId,
    label: `Attempt ${index + 1}`,
    value: sitting.score,
    display: String(sitting.score),
    caption: sat(sitting.submittedAt),
  }));

  const reference: PlotReference | undefined =
    cohort?.topperScore == null
      ? undefined
      : { value: cohort.topperScore, label: 'Topper', tone: 'good' };

  return (
    <ChartFigure title="Retakes" meta={plural(sittings.length, 'sitting')}>
      <LinePlot
        points={points}
        max={maxMarks}
        height={RETAKE_HEIGHT}
        reference={reference}
        aria-label="Marks on each sitting of this paper"
      />
    </ChartFigure>
  );
}
