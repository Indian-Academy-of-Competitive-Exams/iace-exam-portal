/**
 * The moment after a paper is handed in, ported from the web's `submitted.tsx`.
 * Marking is a queued job, so this shows what the sitting knows about ITSELF and
 * polls for the score card. The report opens the moment that lands.
 */
import { ActivityIndicator, ScrollView, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useUnstableNativeVariable } from 'nativewind';
import { pollDelayMs, shouldKeepPolling, type EndedSitting } from '@iace/app-kit';
import { Text } from '../../../src/components/ui/text';
import { isMarkingPending } from '../../../src/lib/exam-routes';
import { DETAIL_ROUTES, ROUTES } from '../../../src/lib/nav';
import { plural } from '../../../src/lib/plural';
import { endedSittingQuery, scoreCardQuery } from '../../../src/lib/queries';
import { cn } from '../../../src/lib/cn';
import { Alert } from '../../../src/components/ui/alert';
import { Button } from '../../../src/components/ui/button';
import { Card } from '../../../src/components/ui/card';
import { EmptyState, EMPTY_STATE_KINDS } from '../../../src/components/ui/empty-state';

type Marking = 'MARKING' | 'MARKED' | 'FAILED';

function markingOf(card: { isSuccess: boolean; isError: boolean }): Marking {
  if (card.isSuccess) return 'MARKED';
  if (card.isError) return 'FAILED';
  return 'MARKING';
}

export default function SubmittedScreen() {
  const { attemptId = '' } = useLocalSearchParams<{ attemptId: string }>();
  const router = useRouter();
  // Absent when Android killed the process in between: the screen still stands without it.
  const handedIn = useQuery(endedSittingQuery(attemptId)).data;

  const card = useQuery({
    ...scoreCardQuery(attemptId),
    enabled: attemptId !== '',
    retry: (count, error) => isMarkingPending(error) && shouldKeepPolling(count),
    retryDelay: (count) => pollDelayMs(count),
  });

  return (
    <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-5 px-5 py-6">
      {handedIn ? <OwnEffort sitting={handedIn} /> : null}

      <View className="gap-2">
        <Text variant="section">Marking</Text>
        <MarkingState marking={markingOf(card)} onRetry={card.refetch} />
      </View>

      {card.isSuccess ? (
        <Button onPress={() => router.replace(DETAIL_ROUTES.REPORT(attemptId))}>
          See your result
        </Button>
      ) : null}

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

function MarkingState({ marking, onRetry }: Readonly<{ marking: Marking; onRetry: () => void }>) {
  const spinnerColor = useUnstableNativeVariable('--muted-foreground');

  if (marking === 'MARKED') {
    return <Alert variant="success">Your paper has been marked.</Alert>;
  }

  if (marking === 'FAILED') {
    return (
      <EmptyState
        kind={EMPTY_STATE_KINDS.FAILURE}
        title="Your score card did not load"
        hint="Your paper is handed in and safe."
        onRetry={onRetry}
      />
    );
  }

  return (
    <View className="flex-row items-center gap-3 py-2">
      <ActivityIndicator color={typeof spinnerColor === 'string' ? spinnerColor : undefined} />
      <Text variant="body">Marking your paper</Text>
    </View>
  );
}
