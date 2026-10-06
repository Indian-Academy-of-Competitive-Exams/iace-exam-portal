/**
 * The moment after a paper is handed in, ported from the web's `submitted.tsx`: the sitting's own
 * effort, section by section, beside the field's. Nothing here is a mark, so nothing waits on marking.
 */
import { ScrollView, View } from 'react-native';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { usePrefetchQuery, useQuery } from '@tanstack/react-query';
import {
  EFFORT_RUNNERS,
  effortLine,
  minutes,
  paperEffort,
  sectionReadings,
  type EffortReading,
} from '@iace/app-kit';
import { type FieldEffort, type SectionEffort } from '@iace/contracts';
import { Text } from '../../../src/components/ui/text';
import { DETAIL_ROUTES, ROUTES } from '../../../src/lib/nav';
import { plural } from '../../../src/lib/plural';
import { endedSittingQuery, fieldEffortQuery, scoreCardAheadQuery } from '../../../src/lib/queries';
import { Button } from '../../../src/components/ui/button';
import { Card } from '../../../src/components/ui/card';
import { Hero, HeroFigure } from '../../../src/components/ui/hero';
import { MeasureBars, type MeasureBar } from '../../../src/components/ui/measure-bars';
import { StatTile, StatTileRow } from '../../../src/components/ui/stat-tile';

/** One hue a runner, the same on every figure, so a bar is recognised before its label is read. */
const RUNNER_TONES = {
  [EFFORT_RUNNERS.YOU]: 1,
  [EFFORT_RUNNERS.TOPPER]: 2,
  [EFFORT_RUNNERS.FIELD]: 3,
  [EFFORT_RUNNERS.PREVIOUS]: 4,
} as const;

export default function SubmittedScreen() {
  const { attemptId = '' } = useLocalSearchParams<{ attemptId: string }>();
  const router = useRouter();
  const handedIn = useQuery(endedSittingQuery(attemptId)).data;
  const field = useQuery(fieldEffortQuery(attemptId));
  // Asked for while the student reads, so the result is already held when they reach the button.
  usePrefetchQuery(scoreCardAheadQuery(attemptId));

  // Absent when Android killed the process in between: the result is all there is to open.
  if (!handedIn) return <Redirect href={DETAIL_ROUTES.REPORT(attemptId)} />;

  const paper = paperEffort(handedIn.sections);
  const cohortSize = field.data?.cohortSize ?? 0;

  return (
    <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-5 px-5 py-6">
      <Hero eyebrow="Your paper">
        <HeroFigure
          value={paper.attempted}
          unit={`/ ${paper.total}`}
          caption={effortLine(handedIn.sections, field.data)}
        />
      </Hero>

      <StatTileRow>
        <StatTile label="Time spent" value={minutes(paper.timeSpentSec)} />
        {cohortSize > 0 ? <StatTile label="Candidates ranked" value={cohortSize} /> : null}
      </StatTileRow>

      {handedIn.sections.map((section) => (
        <SectionEffortFigures key={section.id} section={section} field={field.data} />
      ))}

      <Button onPress={() => router.replace(DETAIL_ROUTES.REPORT(attemptId))}>
        See your result
      </Button>

      <Button variant="outline" onPress={() => router.dismissTo(ROUTES.TESTS)}>
        Go to your tests
      </Button>
    </ScrollView>
  );
}

/** One section: how much of it was answered and how long it took, beside whoever it can stand beside. */
function SectionEffortFigures({
  section,
  field,
}: Readonly<{ section: SectionEffort; field: FieldEffort | undefined }>) {
  const readings = sectionReadings(section, field);

  return (
    <View className="gap-2">
      <View className="flex-row items-baseline justify-between gap-3">
        <Text variant="section" className="flex-1" numberOfLines={1}>
          {section.name}
        </Text>
        <Text variant="meta">{plural(section.total, 'question')}</Text>
      </View>
      <Card className="gap-4 p-4">
        <View className="gap-3">
          <Text variant="subsection">Attempted</Text>
          <MeasureBars bars={readings.map(attemptedBar)} max={section.total} />
        </View>
        <View className="gap-3 border-t border-border pt-4">
          <Text variant="subsection">Time</Text>
          <MeasureBars bars={readings.map(timeBar)} max={0} />
        </View>
      </Card>
    </View>
  );
}

/** A mean is rarely whole, so it is read to one decimal; a whole count never grows a `.0`. */
const countLabel = (count: number) => String(Math.round(count * 10) / 10);

const attemptedBar = (reading: EffortReading): MeasureBar => ({
  key: reading.runner,
  label: reading.label,
  value: reading.attempted,
  display: countLabel(reading.attempted),
  faint: reading.faint,
  tone: RUNNER_TONES[reading.runner],
});

const timeBar = (reading: EffortReading): MeasureBar => ({
  key: reading.runner,
  label: reading.label,
  value: reading.timeSpentSec,
  display: minutes(reading.timeSpentSec),
  faint: reading.faint,
  tone: RUNNER_TONES[reading.runner],
});
