/**
 * The moment after a paper is handed in, ported from the web's `submitted.tsx`: the sitting's own
 * effort, section by section, beside the field's. Nothing here is a mark, so nothing waits on marking.
 */
import { ScrollView, View } from 'react-native';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { usePrefetchQuery, useQuery } from '@tanstack/react-query';
import {
  effortBars,
  effortLine,
  minutes,
  paperEffort,
  sectionReadings,
  plural,
} from '@iace/app-kit';
import { type FieldEffort, type SectionEffort } from '@iace/contracts';
import { Text } from '../../../src/components/ui/text';
import { DETAIL_ROUTES } from '../../../src/lib/nav';
import { endedSittingQuery, fieldEffortQuery, scoreCardAheadQuery } from '../../../src/lib/queries';
import { Button } from '../../../src/components/ui/button';
import { Card } from '../../../src/components/ui/card';
import { Hero, HeroFigure, ScreenTitle } from '../../../src/components/ui/hero';
import { MeasureBars } from '../../../src/components/ui/measure-bars';
import { StatTile, StatTileRow } from '../../../src/components/ui/stat-tile';
import ChartColumn from 'lucide-react-native/icons/chart-column';

export default function SubmittedScreen() {
  const { attemptId = '' } = useLocalSearchParams<{ attemptId: string }>();
  const router = useRouter();
  const handedIn = useQuery(endedSittingQuery(attemptId)).data;
  const field = useQuery(fieldEffortQuery(attemptId));
  // Asked for while the student reads, so the result is already held when they reach the button.
  usePrefetchQuery(scoreCardAheadQuery(attemptId));

  // No summary the server kept — the process was killed in between, or it counted the paper differently.
  if (!handedIn?.sections) return <Redirect href={DETAIL_ROUTES.REPORT(attemptId)} />;

  const paper = paperEffort(handedIn.sections);
  const cohortSize = field.data?.cohortSize ?? 0;

  return (
    <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-5 px-5 py-6">
      <ScreenTitle>Handed in</ScreenTitle>

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

      <Button icon={ChartColumn} onPress={() => router.replace(DETAIL_ROUTES.REPORT(attemptId))}>
        See your result
      </Button>
    </ScrollView>
  );
}

/** One section: how much of it was answered and how long it took, beside whoever it can stand beside. */
function SectionEffortFigures({
  section,
  field,
}: Readonly<{ section: SectionEffort; field: FieldEffort | undefined }>) {
  const bars = effortBars(sectionReadings(section, field));

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
          <MeasureBars bars={bars.attempted} max={section.total} />
        </View>
        <View className="gap-3 border-t border-border pt-4">
          <Text variant="subsection">Time</Text>
          <MeasureBars bars={bars.time} max={0} />
        </View>
      </Card>
    </View>
  );
}
