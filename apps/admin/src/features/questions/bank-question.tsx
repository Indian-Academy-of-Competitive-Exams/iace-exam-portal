import { useCallback, useMemo, useState } from 'react';
import { BookOpen, Pencil } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AppException,
  DIFFICULTY_LABELS,
  DIFFICULTY_LEVEL,
  ErrorCodes,
  FEATURE_KEYS,
  PERMISSION_LEVELS,
  QUESTION_STATUS,
} from '@iace/contracts';
import { Badge, Button, ConfirmDialog } from '@iace/ui';
import { api } from '../../lib/api';
import {
  QUERY_KEYS,
  QUESTION_CODE_FIELD,
  QUESTION_STATUS_LABELS,
  QUESTION_STATUS_VARIANT,
  ROUTES,
  heldQuestionQueryKey,
  questionQueryKey,
} from '../../lib/constants';
import { useAuth } from '../../providers/auth';
import {
  AuthoringWorkspace,
  type Held,
  type WorkspaceSource,
} from '../authoring/authoring-workspace';
import { headerOf, stateOf, toDraft } from '../authoring/question-scaffold';

const CODE_TAKEN = 'Another question already has that code';

/** A code the bank already holds comes back as the bare unique-index refusal; it is put on the code's own field. */
function codeRefusal(error: unknown): unknown {
  if (!AppException.is(error) || error.code !== ErrorCodes.CONFLICT) return error;
  const target = (error.details as { target?: unknown } | undefined)?.target;
  if (!Array.isArray(target) || !target.includes(QUESTION_CODE_FIELD)) return error;
  return new AppException(ErrorCodes.CONFLICT, CODE_TAKEN, {
    fieldErrors: { [QUESTION_CODE_FIELD]: [CODE_TAKEN] },
  });
}

/** The bank's own question, read or corrected on the same page every section is authored on. */
export function BankQuestionPage({ readOnly = false }: Readonly<{ readOnly?: boolean }>) {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const canWrite = useAuth().can(FEATURE_KEYS.QUESTION_MANAGEMENT, PERMISSION_LEVELS.WRITE);

  const [unsaved, setUnsaved] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const toReading = useCallback(() => navigate(ROUTES.QUESTION(id ?? '')), [id, navigate]);

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
        {question?.status === QUESTION_STATUS.ARCHIVED ? (
          <Badge variant={QUESTION_STATUS_VARIANT[question.status]}>
            {QUESTION_STATUS_LABELS[question.status]}
          </Badge>
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
            header: { ...headerOf(question), questionCode: question.questionCode ?? '' },
            state: stateOf(question),
            stamp: question.updatedAt,
          };
        },
      }),
      save: async (key, held) => {
        try {
          // Refused if it moved since this page read it: an edit made elsewhere is not overwritten.
          await api.admin.questions.update(key, {
            ...toDraft(held.state, held.header),
            expectedUpdatedAt: held.stamp,
          });
        } catch (error) {
          // Read again, so reopening the edit starts from what the bank holds and not the copy just refused.
          void queryClient.invalidateQueries({ queryKey: questionQueryKey(key) });
          throw codeRefusal(error);
        }
        await settle();
        navigate(ROUTES.QUESTION(key));
      },
      subjectLocked: false,
      checkDuplicates: false,
      create:
        id || readOnly
          ? undefined
          : {
              header: {
                subjectId: '',
                topicId: '',
                difficulty: DIFFICULTY_LEVEL.MEDIUM,
                tags: '',
                questionCode: '',
              },
              save: async (held) => {
                await api.admin.questions
                  .create(toDraft(held.state, held.header))
                  .catch((error: unknown) => {
                    throw codeRefusal(error);
                  });
                await settle();
              },
            },
    };
  }, [id, lead, navigate, queryClient, readOnly]);

  return (
    <>
      <AuthoringWorkspace
        // A fresh workspace each way, so edits left behind cannot show through the read card.
        key={readOnly ? 'reading' : 'writing'}
        source={source}
        startAt={id ?? null}
        saveLabel={id ? 'Save' : 'Save and next'}
        onUnsavedChange={setUnsaved}
        extraActions={
          id && canWrite ? (
            <Button
              asChild={readOnly}
              variant="outline"
              size="sm"
              onClick={readOnly ? undefined : () => (unsaved > 0 ? setLeaving(true) : toReading())}
            >
              {readOnly ? (
                <Link to={ROUTES.QUESTION_EDIT(id)}>
                  <Pencil aria-hidden />
                  Edit question
                </Link>
              ) : (
                <>
                  <BookOpen aria-hidden />
                  Back to reading
                </>
              )}
            </Button>
          ) : undefined
        }
      />

      <ConfirmDialog
        open={leaving}
        onOpenChange={setLeaving}
        destructive
        title="Discard the unsaved changes?"
        description="The changes to this question have not been saved, and reading it again drops them."
        confirmLabel="Discard changes"
        onConfirm={() => {
          setLeaving(false);
          toReading();
        }}
      />
    </>
  );
}
