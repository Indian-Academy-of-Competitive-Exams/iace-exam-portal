/**
 * The moment after a paper is handed in, ported from the web's `submitted.tsx`.
 * Marking is a queued job, so this shows what the sitting knows about ITSELF and
 * hands the student the way to their result when they want it.
 */
import { ScrollView, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { type EndedSitting } from '@iace/app-kit';
import { Text } from '../../../src/components/ui/text';
import { DETAIL_ROUTES, ROUTES } from '../../../src/lib/nav';
import { plural } from '../../../src/lib/plural';
import { endedSittingQuery } from '../../../src/lib/queries';
import { cn } from '../../../src/lib/cn';
import { Alert } from '../../../src/components/ui/alert';
import { Button } from '../../../src/components/ui/button';
import { Card } from '../../../src/components/ui/card';

export default function SubmittedScreen() {
  const { attemptId = '' } = useLocalSearchParams<{ attemptId: string }>();
  const router = useRouter();
  // Absent when Android killed the process in between: the screen still stands without it.
  const handedIn = useQuery(endedSittingQuery(attemptId)).data;

  return (
    <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-5 px-5 py-6">
      {handedIn ? <OwnEffort sitting={handedIn} /> : null}

      <Alert variant="info">
        Your paper is safe. Marking is queued, so your result may take a moment.
      </Alert>

      <Button onPress={() => router.replace(DETAIL_ROUTES.REPORT(attemptId))}>
        See your result
      </Button>

      <Button variant="outline" onPress={() => router.dismissTo(ROUTES.TESTS)}>
        Go to your tests
      </Button>
    </ScrollView>
  );
}

/** Their own paper, not the cohort's: nothing here needs the marking to have run. */
function OwnEffort({ sitting }: Readonly<{ sitting: EndedSitting }>) {
  return (
    <View className="gap-2">
      <Text variant="section">Your paper</Text>
      <Card>
        {sitting.sections.map((section, index) => (
          <View key={section.id} className={cn('gap-1 p-4', index > 0 && 'border-t border-border')}>
            <Text variant="label">{section.name}</Text>
            <Text variant="meta">
              {`${plural(section.total, 'question')} · ${section.attempted} attempted · ${section.unattempted} unattempted`}
            </Text>
          </View>
        ))}
      </Card>
    </View>
  );
}
