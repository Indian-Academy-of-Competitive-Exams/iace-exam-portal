/**
 * One saved question, read where it was found. It reuses the review surface's own reader rather
 * than a second one, so a bookmark shows exactly what the solutions screen would have shown.
 */
import { useQuery } from '@tanstack/react-query';
import { LANGUAGE_MODE, type SavedQuestion } from '@iace/contracts';
import { isSittingVoided } from '@iace/app-kit';
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
import { savedSolutionQuery } from '../../lib/queries';
import { ReviewQuestion } from './review-paper';

/** This one question alone: a saved row has no section to name, so it asks by question. */
function useSatQuestion(saved: SavedQuestion) {
  const attemptId = saved.attemptId ?? '';
  const solutions = useQuery({
    ...savedSolutionQuery(attemptId, saved.questionId),
    enabled: attemptId !== '',
  });

  return {
    question: solutions.data?.questions[0],
    languages: solutions.data?.languages ?? ['EN'],
    isLoading: solutions.isLoading,
    isError: solutions.isError && !isSittingVoided(solutions.error),
    retry: () => void solutions.refetch(),
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
