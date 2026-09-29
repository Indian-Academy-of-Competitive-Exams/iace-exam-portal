/**
 * One saved question, read where it was found. It reuses the review's own
 * reader rather than a second one, so a bookmark shows exactly what the
 * solutions screen would have shown.
 */
/// <reference types="nativewind/types" />
import { Modal, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LANGUAGE_MODE, type SavedQuestion } from '@iace/contracts';
import { Text } from '../ui/text';
import { solutionsQuery } from '../../lib/queries';
import { Button } from '../ui/button';
import { EmptyState, EMPTY_STATE_KINDS } from '../ui/empty-state';
import { Skeleton } from '../ui/skeleton';
import { ReviewContent } from '../review/review-content';

export function SavedQuestionSheet({
  saved,
  onClose,
}: Readonly<{ saved: SavedQuestion; onClose: () => void }>) {
  const held = useSatQuestion(saved);
  const insets = useSafeAreaInsets();

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
        <View className="flex-row items-center justify-between gap-3 border-b border-border px-5 py-3">
          <Text variant="section" className="flex-1" numberOfLines={1}>
            {saved.testTitle ?? 'This question'}
          </Text>
          <Button variant="ghost" size="sm" onPress={onClose}>
            Close
          </Button>
        </View>

        {held.isLoading ? (
          <View className="flex-1 p-5">
            <Skeleton className="flex-1 rounded-xl" />
          </View>
        ) : null}

        {held.isError ? (
          <View className="flex-1 justify-center px-6">
            <EmptyState
              kind={EMPTY_STATE_KINDS.FAILURE}
              title="This question did not load"
              onRetry={held.retry}
            />
          </View>
        ) : null}

        {!held.isLoading && !held.isError && !held.question ? (
          <View className="flex-1 justify-center px-6">
            <EmptyState
              kind={EMPTY_STATE_KINDS.REFUSED}
              title="This sitting is no longer available"
              // ui-copy-ok: consequence — the row survives what it was saved from
              hint="The question stays on your list; what you answered on it does not."
            />
          </View>
        ) : null}

        {held.question ? (
          <ReviewContent
            question={held.question}
            languages={held.languages}
            languageMode={LANGUAGE_MODE.SINGLE}
          />
        ) : null}
      </View>
    </Modal>
  );
}

/** The review screen's own read, cached per sitting so a second row is free. */
function useSatQuestion(saved: SavedQuestion) {
  const attemptId = saved.attemptId ?? '';
  const solutions = useQuery({ ...solutionsQuery(attemptId), enabled: attemptId !== '' });

  return {
    question: solutions.data?.questions.find((row) => row.questionId === saved.questionId),
    languages: solutions.data?.languages ?? ['EN'],
    isLoading: solutions.isLoading,
    isError: solutions.isError,
    retry: () => void solutions.refetch(),
  };
}
