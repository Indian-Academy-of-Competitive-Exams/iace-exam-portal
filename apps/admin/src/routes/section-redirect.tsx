import { Navigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { EmptyState, EMPTY_STATE_KINDS, LoadingState } from '@iace/ui';
import { api } from '../lib/api';
import { QUERY_KEYS, ROUTES } from '../lib/constants';
import { SECTION_AS } from '../components/authoring/section-moment';

/** An address from before the workspace, sent on to the section it named — a bookmark still lands. */
export function SectionRedirect() {
  const { assignmentId, testId, sectionId, questionId } = useParams();
  const reading = useQuery({
    queryKey: [...QUERY_KEYS.ASSIGNMENTS, 'one', assignmentId ?? ''],
    queryFn: () => api.admin.assignments.one(assignmentId ?? ''),
    enabled: assignmentId !== undefined,
  });

  if (!assignmentId)
    return <Navigate replace to={target(testId ?? '', sectionId ?? '', questionId)} />;
  if (reading.isError) {
    return (
      <EmptyState
        kind={EMPTY_STATE_KINDS.FAILURE}
        title="Could not open this section"
        onRetry={reading.refetch}
      />
    );
  }
  if (!reading.data) return <LoadingState />;

  const { testId: test, baseConfigSectionId } = reading.data;
  const asReader = `?as=${SECTION_AS.READER}`;
  return <Navigate replace to={`${target(test, baseConfigSectionId, questionId)}${asReader}`} />;
}

function target(testId: string, sectionId: string, questionId: string | undefined): string {
  return questionId
    ? ROUTES.SECTION_QUESTION(testId, sectionId, questionId)
    : ROUTES.SECTION(testId, sectionId);
}
