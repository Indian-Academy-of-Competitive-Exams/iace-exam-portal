import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { isMarkingPending, useBookmarks } from '@iace/app-kit';
import { EmptyState, EMPTY_STATE_KINDS } from '@iace/ui';
import { BlockSkeleton } from '../components/ui';
import { LANGUAGE_MODE } from '@iace/contracts';
import { api } from '../lib/api';
import { solutionsQuery } from '../lib/queries';
import { ReviewPaper } from '../components/review/review-paper';

/** One read: the solutions carry the student's own answers, the marks and the key together. */
export function SolutionPanel() {
  const { attemptId = '' } = useParams();

  const solutions = useQuery(solutionsQuery(attemptId));
  const stars = useBookmarks(api, attemptId, solutions.data !== undefined);

  return (
    <>
      {solutions.isLoading ? <BlockSkeleton className="h-96" /> : null}
      {solutions.isError ? (
        <PaperAbsence error={solutions.error} onRetry={() => void solutions.refetch()} />
      ) : null}
      {solutions.data ? (
        <ReviewPaper
          sections={solutions.data.sections}
          questions={solutions.data.questions}
          languages={solutions.data.languages}
          languageMode={LANGUAGE_MODE.SINGLE}
          bookmark={stars}
        />
      ) : null}
    </>
  );
}

/** No paper to draw: marking still queued is not a failure, and a failure carries its retry. */
function PaperAbsence({ error, onRetry }: Readonly<{ error: unknown; onRetry: () => void }>) {
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
