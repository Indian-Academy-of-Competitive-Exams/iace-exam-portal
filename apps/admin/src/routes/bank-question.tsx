import { useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { DIFFICULTY_LEVEL } from '@iace/contracts';
import { api } from '../lib/api';
import { QUERY_KEYS, ROUTES, heldQuestionQueryKey, questionQueryKey } from '../lib/constants';
import {
  AuthoringWorkspace,
  type Held,
  type WorkspaceSource,
} from '../components/authoring/authoring-workspace';
import { headerOf, stateOf, toDraft } from '../components/authoring/question-scaffold';

const lead = <span className="text-sm font-semibold">Question</span>;

/** The bank's own question, written or corrected on the same page every section is authored on. */
export function BankQuestionPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const source = useMemo((): WorkspaceSource => {
    const settle = () => queryClient.invalidateQueries({ queryKey: QUERY_KEYS.QUESTIONS });
    return {
      cards: id ? [{ key: id, lead, editable: true }] : [],
      query: (key) => ({
        queryKey: heldQuestionQueryKey(key),
        queryFn: async (): Promise<Held> => {
          // Through the detail's own key, so the page it was opened from has already read it.
          const question = await queryClient.fetchQuery({
            queryKey: questionQueryKey(key),
            queryFn: () => api.admin.questions.detail(key),
          });
          return {
            header: headerOf(question),
            state: stateOf(question),
            stamp: question.updatedAt,
          };
        },
      }),
      save: async (key, held) => {
        // Refused if it moved since this page read it: an edit made elsewhere is not overwritten.
        await api.admin.questions.update(key, {
          ...toDraft(held.state, held.header),
          expectedUpdatedAt: held.stamp,
        });
        await settle();
        navigate(ROUTES.QUESTION(key));
      },
      subjectLocked: false,
      checkDuplicates: false,
      create: id
        ? undefined
        : {
            header: { subjectId: '', topicId: '', difficulty: DIFFICULTY_LEVEL.MEDIUM, tags: '' },
            save: async (held) => {
              await api.admin.questions.create(toDraft(held.state, held.header));
              await settle();
            },
          },
    };
  }, [id, navigate, queryClient]);

  return (
    <AuthoringWorkspace
      source={source}
      startAt={id ?? null}
      saveLabel={id ? 'Save' : 'Save and next'}
    />
  );
}
