/**
 * One saved question, read where it was found. It reuses the review surface's own reader rather
 * than a second one, so a bookmark shows exactly what the solutions screen would have shown.
 */
import { useQuery } from '@tanstack/react-query';
import { LANGUAGE_MODE, type SavedQuestion } from '@iace/contracts';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogHeader,
  DialogTitle,
  EmptyState,
  EMPTY_STATE_KINDS,
  SkeletonParagraph,
} from '@iace/ui';
import { api } from '../../lib/api';
import { ReviewQuestion, type ReviewedQuestion } from './review-paper';

/** The two reads the review screen already makes, cached per sitting so a second row is free. */
function useSatQuestion(saved: SavedQuestion) {
  const attemptId = saved.attemptId ?? '';

  const card = useQuery({
    queryKey: ['me', 'score-card', attemptId],
    queryFn: () => api.me.scoreCard(attemptId),
    enabled: attemptId !== '',
  });
  const solutions = useQuery({
    queryKey: ['me', 'solutions', attemptId],
    queryFn: () => api.me.solutions(attemptId),
    enabled: attemptId !== '',
    retry: false,
  });

  const mine = card.data?.questions.find((row) => row.questionId === saved.questionId);
  const keyed = solutions.data?.questions.find((row) => row.questionId === saved.questionId);
  const question: ReviewedQuestion | undefined = mine ? { ...mine, ...keyed } : undefined;

  return {
    question,
    languages: solutions.data?.languages ?? ['EN'],
    isLoading: card.isLoading,
    isError: card.isError,
    retry: () => void card.refetch(),
  };
}

export function SavedQuestionDialog({
  saved,
  onClose,
}: Readonly<{ saved: SavedQuestion; onClose: () => void }>) {
  const held = useSatQuestion(saved);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>{saved.testTitle ?? 'This question'}</DialogTitle>
        </DialogHeader>

        <DialogBody className="py-5">
          {held.isLoading ? <SkeletonParagraph lines={8} /> : null}

          {held.isError ? (
            <EmptyState
              kind={EMPTY_STATE_KINDS.FAILURE}
              title="This question did not load"
              onRetry={held.retry}
            />
          ) : null}

          {!held.isLoading && !held.isError && !held.question ? (
            <EmptyState
              kind={EMPTY_STATE_KINDS.REFUSED}
              title="This sitting is no longer available"
              hint="The question stays on your list; what you answered on it does not."
            />
          ) : null}

          {held.question ? (
            <ReviewQuestion
              question={held.question}
              index={0}
              total={1}
              languages={held.languages}
              languageMode={LANGUAGE_MODE.SINGLE}
              onStep={() => {}}
            />
          ) : null}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
