import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { isMarkingPending, isSolutionsShut, reviewedQuestions, useBookmarks } from '@iace/app-kit';
import { Alert, EmptyState, EMPTY_STATE_KINDS } from '@iace/ui';
import { BlockSkeleton } from '../components/ui';
import {
  LANGUAGE_MODE,
  type ExamSection,
  type ScoreCard,
  type SolutionReport,
} from '@iace/contracts';
import { api } from '../lib/api';
import { scoreCardQuery, solutionsQuery } from '../lib/queries';
import { ReviewPaper } from '../components/review/review-paper';

export function SolutionPanel() {
  const { attemptId = '' } = useParams();

  const card = useQuery(scoreCardQuery(attemptId));
  const solutions = useQuery(solutionsQuery(attemptId));

  const refusal = isSolutionsShut(solutions.error) ? solutions.error : null;
  // Only past the gate: the star rides the same rule the answer key does.
  const open = solutions.data !== undefined;
  const stars = useBookmarks(api, attemptId, open);

  return (
    <>
      {card.isLoading || solutions.isLoading ? <BlockSkeleton className="h-96" /> : null}
      {card.isError ? <CardAbsence error={card.error} onRetry={() => void card.refetch()} /> : null}
      {card.data ? (
        <ReviewPaper
          sections={sectionsOf(card.data, solutions.data)}
          questions={reviewedQuestions(card.data, solutions.data)}
          languages={solutions.data?.languages ?? ['EN']}
          languageMode={LANGUAGE_MODE.SINGLE}
          bookmark={open ? stars : undefined}
          notice={
            refusal ? (
              /* ui-copy-ok: consequence */
              <Alert variant="info">{refusal.message}</Alert>
            ) : null
          }
        />
      ) : null}
    </>
  );
}

/** No card, no paper to draw: marking still queued is not a failure, and a failure carries its retry. */
function CardAbsence({ error, onRetry }: Readonly<{ error: unknown; onRetry: () => void }>) {
  return isMarkingPending(error) ? (
    <EmptyState title="No marks yet" onRetry={onRetry} />
  ) : (
    <EmptyState
      kind={EMPTY_STATE_KINDS.FAILURE}
      title="Your paper did not load"
      onRetry={onRetry}
    />
  );
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
