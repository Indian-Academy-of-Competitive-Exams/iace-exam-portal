import { useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { type AssignmentWithTest } from '@iace/contracts';
import { api } from '../../lib/api';
import { QUERY_KEYS } from '../../lib/constants';
import { QuestionsWindow, type Held, type QuestionsSource } from './questions-window';
import { headerOf, stateOf, toDraft } from './question-scaffold';
import { sectionQuestions } from './section-questions';

/** A section's written questions in the scrolling window, each saved as the section editor saves it. */
export function SectionQuestionsWindow({
  assignment,
  open,
  onOpenChange,
  startAt,
}: Readonly<{
  assignment: AssignmentWithTest;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  startAt: string | null;
}>) {
  const queryClient = useQueryClient();
  const written = useQuery({
    queryKey: [...QUERY_KEYS.AUTHORING, 'section', assignment.id, 'all'],
    queryFn: () => sectionQuestions(assignment.id),
    enabled: open,
  });

  const source = useMemo((): QuestionsSource => {
    const questions = written.data ?? [];
    return {
      title: `${assignment.sectionName} questions`,
      keys: questions.map((question) => question.id),
      query: (id) => ({
        queryKey: [...QUERY_KEYS.AUTHORING, id, 'held'],
        queryFn: async (): Promise<Held> => {
          const question = await api.admin.authoring.detail(id);
          return {
            header: headerOf(question),
            state: stateOf(question),
            stamp: question.updatedAt,
          };
        },
      }),
      lead: (index) => (
        <>
          <span className="text-sm font-semibold tabular-nums">
            {`Question ${index + 1} of ${questions.length}`}
          </span>
        </>
      ),
      subjectLocked: assignment.sectionSubjectId !== null,
      checkDuplicates: true,
      save: async (id, held) => {
        // Refused if it moved since this window read it: an edit made elsewhere is not overwritten.
        await api.admin.authoring.update(id, {
          ...toDraft(held.state, held.header),
          expectedUpdatedAt: held.stamp,
        });
        await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.AUTHORING });
        await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.ASSIGNMENTS });
      },
    };
  }, [written.data, assignment, queryClient]);

  return (
    <QuestionsWindow source={source} open={open} onOpenChange={onOpenChange} startAt={startAt} />
  );
}
