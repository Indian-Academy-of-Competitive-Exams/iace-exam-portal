/// <reference types="nativewind/types" />
import { View } from 'react-native';
import {
  paceWord,
  signed,
  timeSegments,
  timeWords,
  type TimeBenchmark,
  type TimeTone,
  plural,
} from '@iace/app-kit';
import {
  percentLabel,
  placeInSpread,
  round2,
  type CohortCurve,
  type Disposition,
  type TimeUse,
} from '@iace/contracts';
import { Card } from '../ui/card';
import { MeasureBars, type MeasureBar, type MeasureTone } from '../ui/measure-bars';
import { StatTile, StatTileRow } from '../ui/stat-tile';
import { Text } from '../ui/text';

const DASH = '—';

const TONES: Readonly<Record<TimeTone, MeasureTone>> = { positive: 2, negative: 3, neutral: 1 };

/** A caption and a figure on one line, so a comparison is taken in at a glance. */
function Row({ label, value }: Readonly<{ label: string; value: string | number }>) {
  return (
    <View className="flex-row items-baseline gap-2">
      <Text variant="meta">{label}</Text>
      <Text variant="label">{value}</Text>
    </View>
  );
}

function Figure({
  title,
  meta,
  children,
}: Readonly<{ title: string; meta: string; children: React.ReactNode }>) {
  return (
    <View className="gap-3">
      <View className="flex-row items-baseline justify-between gap-3">
        <Text variant="section">{title}</Text>
        <Text variant="muted">{meta}</Text>
      </View>
      <Card className="gap-4 p-5">{children}</Card>
    </View>
  );
}

function rankLabel(rank: number | null, cohortSize: number): string {
  if (rank === null) return DASH;
  return cohortSize > 0 ? `#${rank} of ${cohortSize}` : `#${rank}`;
}

const at = (value: number | null) => (value === null ? DASH : timeWords(value));

/** Where the clock went, and the same total against the crowd's and the topper's. */
export function TimeFigure({
  time,
  counts,
  paceIndex,
  benchmark,
}: Readonly<{
  time: TimeUse;
  counts: Disposition;
  paceIndex: number | null;
  benchmark?: TimeBenchmark;
}>) {
  const bars: MeasureBar[] = timeSegments(time, counts).map((segment) => ({
    key: segment.key,
    label: segment.label,
    value: segment.seconds,
    display: timeWords(segment.seconds),
    tone: TONES[segment.tone],
  }));

  return (
    <Figure title="Time" meta={`${timeWords(time.avgPerQuestionSec)} per question`}>
      <StatTileRow>
        <StatTile label="Total" value={timeWords(time.totalSec)} />
        {paceIndex === null ? null : (
          <StatTile label="Pace" value={`${paceIndex} ${paceWord(paceIndex)}`} />
        )}
      </StatTileRow>
      <MeasureBars bars={bars} max={time.totalSec} />
      {benchmark ? (
        <View className="flex-row flex-wrap gap-x-5 gap-y-1 border-t border-border pt-3">
          <Row label="You" value={timeWords(time.totalSec)} />
          <Row label="Average" value={at(benchmark.average)} />
          <Row label="Topper" value={at(benchmark.topper)} />
        </View>
      ) : null}
    </Figure>
  );
}

/** Where this sitting falls in the spread of scores, one bar per band. */
export function CohortFigure({ cohort }: Readonly<{ cohort: CohortCurve }>) {
  const lowest = cohort.bands[0]?.from ?? null;
  const place = placeInSpread(cohort.score, lowest, cohort.topperScore);
  const peak = Math.max(...cohort.bands.map((band) => band.count), 1);
  const bars: MeasureBar[] = cohort.bands.map((band) => ({
    key: String(band.from),
    label: `${band.from} to ${band.to}${band.isYours ? ' · you' : ''}`,
    value: band.count,
    tone: band.isYours ? 2 : 1,
  }));

  return (
    <Figure title="Score spread" meta={plural(cohort.cohortSize, 'sitting')}>
      <StatTileRow>
        <StatTile label="Rank" value={rankLabel(cohort.rank, cohort.cohortSize)} />
      </StatTileRow>
      <MeasureBars bars={bars} max={peak} />
      {cohort.topperScore === null ? null : (
        <View className="gap-1 border-t border-border pt-3">
          <Row label="Behind the topper" value={round2(cohort.topperScore - cohort.score)} />
          {cohort.averageScore === null ? null : (
            <Row label="Against the average" value={signed(cohort.score - cohort.averageScore)} />
          )}
          {lowest === null ? null : (
            <Row label="Spread" value={`${lowest} to ${cohort.topperScore}`} />
          )}
          {place === null ? null : <Row label="Up that spread" value={percentLabel(place, DASH)} />}
        </View>
      )}
    </Figure>
  );
}
