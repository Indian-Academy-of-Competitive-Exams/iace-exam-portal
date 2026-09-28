import { Navigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ASSIGNMENT_ROLES, type AssignmentRole } from '@iace/contracts';
import { EmptyState, EMPTY_STATE_KINDS, LoadingState } from '@iace/ui';
import { api } from '../lib/api';
import { QUERY_KEYS, ROUTES } from '../lib/constants';

/** Where a section is worked from, by who is working it; the page is the same for all three. */
function sectionFor(role: AssignmentRole | null, testId: string, sectionId: string): string {
  if (role === ASSIGNMENT_ROLES.TYPIST) return ROUTES.TYPING_SECTION(testId, sectionId);
  if (role === ASSIGNMENT_ROLES.PROOFREADER) return ROUTES.READING_SECTION(testId, sectionId);
  return ROUTES.TEST_SECTION(testId, sectionId);
}

const withQuestion = (path: string, questionId: string | undefined) =>
  questionId ? `${path}?q=${encodeURIComponent(questionId)}` : path;

/** An address from before the authoring page, sent on to the section it named — a bookmark still lands. */
export function SectionRedirect({ role = null }: Readonly<{ role?: AssignmentRole | null }>) {
  const { assignmentId, testId, sectionId, questionId } = useParams();
  const held = useQuery({
    queryKey: [...QUERY_KEYS.ASSIGNMENTS, 'one', assignmentId ?? ''],
    queryFn: () => api.admin.assignments.one(assignmentId ?? ''),
    enabled: assignmentId !== undefined,
  });

  if (!assignmentId) {
    const path = sectionFor(role, testId ?? '', sectionId ?? '');
    return <Navigate replace to={withQuestion(path, questionId)} />;
  }
  if (held.isError) {
    return (
      <EmptyState
        kind={EMPTY_STATE_KINDS.FAILURE}
        title="Could not open this section"
        onRetry={held.refetch}
      />
    );
  }
  if (!held.data) return <LoadingState />;

  const { role: heldAs, testId: test, baseConfigSectionId } = held.data;
  return (
    <Navigate
      replace
      to={withQuestion(sectionFor(heldAs, test, baseConfigSectionId), questionId)}
    />
  );
}
