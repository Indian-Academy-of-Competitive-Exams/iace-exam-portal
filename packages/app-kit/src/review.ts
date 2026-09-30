/** A marked paper under review on both clients: their own answer, the marks and the key, in one read. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type ScoreCardQuestion, type SolutionQuestion } from '@iace/contracts';
import { type AppApiClient } from './api-client';
import { bookmarksInAttemptQueryKey, savedQueryKey } from './student-queries';

export type ReviewedQuestion = ScoreCardQuestion & Partial<SolutionQuestion>;

/** How a question went, which is what colours a palette cell and the marker beside an option. */
export const VERDICT = { RIGHT: 'RIGHT', WRONG: 'WRONG', LEFT: 'LEFT' } as const;
export type Verdict = (typeof VERDICT)[keyof typeof VERDICT];

export function verdictOf(question: ReviewedQuestion): Verdict {
  if (question.isCorrect === true) return VERDICT.RIGHT;
  return question.isCorrect === false ? VERDICT.WRONG : VERDICT.LEFT;
}

export interface BookmarkControl {
  saved: ReadonlySet<string>;
  onToggle: (questionId: string) => void;
  pendingId: string | null;
}

/** One read for the whole sitting's stars, and one mutation that toggles whichever was pressed. */
export function useBookmarks(
  api: AppApiClient,
  attemptId: string,
  enabled = true,
): BookmarkControl {
  const queryClient = useQueryClient();

  const stars = useQuery({
    queryKey: bookmarksInAttemptQueryKey(attemptId),
    queryFn: () => api.me.bookmarksInAttempt(attemptId),
    enabled,
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
    // Returned, not dropped: the star stays pending until the read behind it lands, or it shows its old state.
    onSuccess: () => queryClient.invalidateQueries({ queryKey: savedQueryKey() }),
  });

  return {
    saved: new Set(savedIdOf.keys()),
    onToggle: (questionId) => toggle.mutate(questionId),
    pendingId: toggle.isPending ? (toggle.variables ?? null) : null,
  };
}
