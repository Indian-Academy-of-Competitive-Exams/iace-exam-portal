import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ClipboardList } from 'lucide-react';
import { Alert, Button, LoadingState, PageFrame, PageHeader } from '@iace/ui';
import { PageCrumbs } from '@iace/app-kit/browser';
import {
  AppException,
  ErrorCodes,
  LANGUAGE_MODE,
  type ExamSection,
  type ScoreCard,
  type SolutionReport,
} from '@iace/contracts';
import { api } from '../lib/api';
import { NAV_ITEMS, ROUTES, scoreCardQueryKey, solutionsQueryKey } from '../lib/constants';
import { ReviewPaper, type ReviewedQuestion } from '../components/review/review-paper';

export function ReviewPage() {
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
    <PageFrame
      header={
        <PageHeader
          breadcrumbs={
            <PageCrumbs nav={NAV_ITEMS} tail={[{ label: card.data?.testTitle ?? 'Review' }]} />
          }
          title="Review"
          meta={card.data ? `${card.data.score} of ${card.data.maxMarks} marks` : undefined}
          action={
            <Button asChild variant="outline">
              <Link to={ROUTES.SCORE_CARD(attemptId)}>
                <ClipboardList aria-hidden />
                Score card
              </Link>
            </Button>
          }
        />
      }
    >
      {card.isLoading || solutions.isLoading ? <LoadingState /> : null}
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
    </PageFrame>
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
