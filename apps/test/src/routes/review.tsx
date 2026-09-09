import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert } from '@iace/ui';
import { BlockSkeleton } from '../components/ui';
import {
  AppException,
  ErrorCodes,
  LANGUAGE_MODE,
  SAVED_QUESTION_KIND,
  type ExamSection,
  type ScoreCard,
  type SolutionReport,
} from '@iace/contracts';
import { api } from '../lib/api';
import {
  bookmarksInAttemptQueryKey,
  savedQueryKey,
  scoreCardQueryKey,
  solutionsQueryKey,
} from '../lib/constants';
import {
  ReviewPaper,
  type BookmarkControl,
  type ReviewedQuestion,
} from '../components/review/review-paper';

export function SolutionPanel() {
  const { attemptId = '' } = useParams();

  const card = useQuery({
    queryKey: scoreCardQueryKey(attemptId),
    queryFn: () => api.me.scoreCard(attemptId),
  });
  // Refused until the gate opens, which is an ANSWER about this paper, not a failure to retry.
  const solutions = useQuery({
    queryKey: solutionsQueryKey(attemptId),
    queryFn: () => api.me.solutions(attemptId),
    retry: false,
  });

  const refusal = AppException.is(solutions.error) ? solutions.error : null;
  const shut = refusal?.code === ErrorCodes.FORBIDDEN;
  // Only past the gate: the star rides the same rule the answer key does.
  const bookmark = useBookmarks(attemptId, solutions.data !== undefined);

  return (
    <>
      {card.isLoading || solutions.isLoading ? <BlockSkeleton className="h-96" /> : null}
      {card.data ? (
        <ReviewPaper
          sections={sectionsOf(card.data, solutions.data)}
          questions={merged(card.data, solutions.data)}
          languages={solutions.data?.languages ?? ['EN']}
          languageMode={LANGUAGE_MODE.SINGLE}
          bookmark={bookmark}
          notice={
            shut ? (
              /* ui-copy-ok: consequence */
              <Alert variant="info">{refusal.message}</Alert>
            ) : null
          }
        />
      ) : null}
    </>
  );
}

/** One read for the whole sitting's stars, and one mutation that toggles whichever was pressed. */
function useBookmarks(attemptId: string, isOpen: boolean): BookmarkControl | undefined {
  const queryClient = useQueryClient();

  const stars = useQuery({
    queryKey: bookmarksInAttemptQueryKey(attemptId),
    queryFn: () => api.me.bookmarksInAttempt(attemptId),
    enabled: isOpen,
  });

  const savedIdOf = new Map(
    (stars.data?.bookmarks ?? []).map((row) => [row.questionId, row.savedId]),
  );

  const toggle = useMutation({
    mutationFn: (questionId: string) => {
      const savedId = savedIdOf.get(questionId);
      return savedId === undefined
        ? api.me.bookmarkQuestion({ attemptId, questionId })
        : api.me.removeSavedQuestion(savedId);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: bookmarksInAttemptQueryKey(attemptId) });
      void queryClient.invalidateQueries({ queryKey: savedQueryKey(SAVED_QUESTION_KIND.BOOKMARK) });
    },
  });

  if (!isOpen) return undefined;
  return {
    saved: new Set(savedIdOf.keys()),
    onToggle: (questionId) => toggle.mutate(questionId),
    pendingId: toggle.isPending ? (toggle.variables ?? null) : null,
  };
}

/** The solutions carry the paper's own sections; before the gate the score card's stand in. */
function sectionsOf(card: ScoreCard, solutions: SolutionReport | undefined): ExamSection[] {
  if (solutions) return [...solutions.sections];
  return card.sections.map((section) => ({
    id: section.baseConfigSectionId,
    name: section.name,
    order: section.order,
    questionCount: section.questionCount,
    durationSec: null,
  }));
}

/** Their own answers always; the key only where the gate let it through. */
function merged(card: ScoreCard, solutions: SolutionReport | undefined): ReviewedQuestion[] {
  const keyed = new Map((solutions?.questions ?? []).map((row) => [row.questionId, row]));
  return card.questions.map((row) => ({ ...row, ...keyed.get(row.questionId) }));
}
