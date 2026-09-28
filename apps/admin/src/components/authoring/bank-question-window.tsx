import { useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { QUERY_KEYS } from '../../lib/constants';
import { QuestionsWindow, type Held, type QuestionsSource } from './questions-window';
import { headerOf, stateOf, toDraft } from './question-scaffold';

const bankLead = () => <span className="text-sm font-semibold">Question</span>;

/** A bank question in the same window every section edits in, saved through the bank. */
export function BankQuestionWindow({
  questionId,
  open,
  onOpenChange,
}: Readonly<{ questionId: string; open: boolean; onOpenChange: (open: boolean) => void }>) {
  const queryClient = useQueryClient();

  const source = useMemo(
    (): QuestionsSource => ({
      title: 'Question',
      keys: [questionId],
      query: (id) => ({
        queryKey: [...QUERY_KEYS.QUESTION, id, 'held'],
        queryFn: async (): Promise<Held> => {
          const question = await api.admin.questions.detail(id);
          return {
            header: headerOf(question),
            state: stateOf(question),
            stamp: question.updatedAt,
          };
        },
      }),
      lead: bankLead,
      subjectLocked: false,
      checkDuplicates: false,
      save: async (id, held) => {
        // Refused if it moved since this window read it: an edit made elsewhere is not overwritten.
        await api.admin.questions.update(id, {
          ...toDraft(held.state, held.header),
          expectedUpdatedAt: held.stamp,
        });
        await Promise.all(
          [QUERY_KEYS.QUESTION, QUERY_KEYS.QUESTIONS].map((queryKey) =>
            queryClient.invalidateQueries({ queryKey }),
          ),
        );
      },
    }),
    [questionId, queryClient],
  );

  return <QuestionsWindow source={source} open={open} onOpenChange={onOpenChange} startAt={null} />;
}
