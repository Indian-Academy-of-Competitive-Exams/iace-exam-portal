import { useMemo } from 'react';
import { Pencil } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { DIFFICULTY_LABELS, DIFFICULTY_LEVEL } from '@iace/contracts';
import { Button } from '@iace/ui';
import { api } from '../lib/api';
import { QUERY_KEYS, ROUTES, heldQuestionQueryKey, questionQueryKey } from '../lib/constants';
import {
  AuthoringWorkspace,
  type Held,
  type WorkspaceSource,
} from '../components/authoring/authoring-workspace';
import { headerOf, stateOf, toDraft } from '../components/authoring/question-scaffold';

/** The bank's own question, read or corrected on the same page every section is authored on. */
export function BankQuestionPage({ readOnly = false }: Readonly<{ readOnly?: boolean }>) {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const detail = useQuery({
    queryKey: questionQueryKey(id ?? ''),
    queryFn: () => api.admin.questions.detail(id ?? ''),
    enabled: readOnly && Boolean(id),
  });

  const lead = useMemo(() => {
    const question = detail.data;
    const filed = question
      ? [
          [question.subject.name, question.topic?.name].filter(Boolean).join(' / '),
          DIFFICULTY_LABELS[question.difficulty],
          `v${question.version}`,
        ].join(' · ')
      : null;
    return (
      <span className="flex min-w-0 items-baseline gap-2">
        <span className="text-sm font-semibold">{question?.questionCode ?? 'Question'}</span>
        {filed ? (
          <span className="max-w-[28rem] truncate text-xs text-muted-foreground">{filed}</span>
        ) : null}
      </span>
    );
  }, [detail.data]);

  const source = useMemo((): WorkspaceSource => {
    const settle = () => queryClient.invalidateQueries({ queryKey: QUERY_KEYS.QUESTIONS });
    return {
      cards: id ? [{ key: id, lead, editable: !readOnly }] : [],
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
      create:
        id || readOnly
          ? undefined
          : {
              header: { subjectId: '', topicId: '', difficulty: DIFFICULTY_LEVEL.MEDIUM, tags: '' },
              save: async (held) => {
                await api.admin.questions.create(toDraft(held.state, held.header));
                await settle();
              },
            },
    };
  }, [id, lead, navigate, queryClient, readOnly]);

  return (
    <AuthoringWorkspace
      source={source}
      startAt={id ?? null}
      saveLabel={id ? 'Save' : 'Save and next'}
      extraActions={
        readOnly && id ? (
          <Button asChild variant="outline" size="sm">
            <Link to={ROUTES.QUESTION_EDIT(id)}>
              <Pencil aria-hidden />
              Edit question
            </Link>
          </Button>
        ) : undefined
      }
    />
  );
}
