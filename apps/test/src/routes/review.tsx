import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Alert } from '@iace/ui';
import { BlockSkeleton } from '../components/ui';
import {
  AppException,
  ErrorCodes,
  LANGUAGE_MODE,
  type ExamSection,
  type ScoreCard,
  type SolutionReport,
} from '@iace/contracts';
import { api } from '../lib/api';
import { scoreCardQueryKey, solutionsQueryKey } from '../lib/constants';
import { ReviewPaper, type ReviewedQuestion } from '../components/review/review-paper';

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

  return (
    <>
      {card.isLoading || solutions.isLoading ? <BlockSkeleton className="h-96" /> : null}
      {card.data ? (
        <ReviewPaper
          sections={sectionsOf(card.data, solutions.data)}
          questions={merged(card.data, solutions.data)}
          languages={solutions.data?.languages ?? ['EN']}
          languageMode={LANGUAGE_MODE.SINGLE}
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
