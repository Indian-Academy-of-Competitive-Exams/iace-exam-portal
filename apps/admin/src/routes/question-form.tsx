import { useEffect, useState } from 'react';
import { Check, Pencil } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { QUESTION_STATUS, FEATURE_KEYS, PERMISSION_LEVELS } from '@iace/contracts';
import { applyFieldErrors, bannerMessage } from '@iace/app-kit';
import { PageCrumbs } from '@iace/app-kit/browser';
import {
  Alert,
  Button,
  ConfirmDialog,
  FormPanel,
  PageHeader,
  Skeleton,
  SkeletonParagraph,
} from '@iace/ui';
import { api } from '../lib/api';
import { useAuth } from '../providers/auth';
import { NAV_ITEMS, QUERY_KEYS, ROUTES } from '../lib/constants';
import { QuestionFields } from '../components/question-fields';
import {
  SERVER_FIELDS,
  emptyValues,
  toDraft,
  valuesOf,
  type QuestionFormValues,
} from '../components/question-draft';

/** One question, by hand. The bulk of the bank arrives by sheet; this is for the one an admin writes or fixes. */

export function QuestionFormPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const existing = id !== undefined;
  const questionId = id ?? '';
  // A new question opens ready to type; one that already exists opens read-only.
  const [isEditing, setIsEditing] = useState(!existing);

  const question = useQuery({
    queryKey: [...QUERY_KEYS.QUESTION, id],
    queryFn: () => api.admin.questions.detail(questionId),
    enabled: existing,
  });

  const form = useForm<QuestionFormValues>({ defaultValues: emptyValues() });

  // The saved question arrives after the first render; reset rather than key the
  // whole form off it, so a half-typed edit is not thrown away by a refetch.
  const loaded = question.data;
  useEffect(() => {
    if (loaded) form.reset(valuesOf(loaded));
  }, [loaded, form]);

  const save = useMutation({
    meta: { success: existing ? 'Question saved.' : 'Question added.' },
    mutationFn: (values: QuestionFormValues) =>
      existing
        ? api.admin.questions.update(questionId, toDraft(values, loaded))
        : api.admin.questions.create(toDraft(values)),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.QUESTIONS });
      navigate(ROUTES.QUESTIONS);
    },
    onError: (error) => applyFieldErrors(error, form.setError, [...SERVER_FIELDS]),
  });

  const banner = bannerMessage(save.error, [...SERVER_FIELDS]);

  let title = 'New question';
  if (existing) title = isEditing ? 'Edit question' : 'Question';

  /** A new question has nowhere to fall back to, so Cancel leaves; an existing one returns to itself. */
  const cancel = () => {
    if (!existing) return navigate(ROUTES.QUESTIONS);
    form.reset();
    setIsEditing(false);
  };

  if (existing && question.isLoading) {
    // The form has a known shape, so it is drawn and held rather than spun at.
    return (
      <div className="flex flex-col gap-4">
        <Skeleton variant="title" />
        <SkeletonParagraph lines={6} />
      </div>
    );
  }

  return (
    <FormPanel
      disabled={!isEditing}
      onSubmit={form.handleSubmit((values) => save.mutate(values))}
      footer={
        isEditing ? (
          <>
            <Button type="button" variant="outline" onClick={cancel}>
              Cancel
            </Button>
            <Button type="submit" loading={save.isPending}>
              {existing ? 'Save question' : 'Add question'}
            </Button>
          </>
        ) : undefined
      }
      header={
        <>
          <PageHeader
            breadcrumbs={<PageCrumbs nav={NAV_ITEMS} />}
            title={title}
            action={
              <HeaderActions
                isEditing={isEditing}
                isDraft={question.data?.status === QUESTION_STATUS.DRAFT}
                id={id}
                onEdit={() => setIsEditing(true)}
              />
            }
          />

          {banner ? <Alert variant="danger">{banner}</Alert> : null}
        </>
      }
    >
      <QuestionFields form={form} saved={loaded} />
    </FormPanel>
  );
}

/** Editing hides both: while the form is live, Save and Cancel are the only decisions on offer. */
function HeaderActions({
  isEditing,
  isDraft,
  id,
  onEdit,
}: Readonly<{ isEditing: boolean; isDraft: boolean; id?: string; onEdit: () => void }>) {
  if (isEditing) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {isDraft && id ? <ApproveButton id={id} /> : null}
      <Button variant="outline" size="sm" onClick={onEdit}>
        <Pencil aria-hidden />
        Edit question
      </Button>
    </div>
  );
}

/** Reviewing here rather than only from the list: the reader who just read it is the one deciding. */
function ApproveButton({ id }: Readonly<{ id: string }>) {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const [asking, setAsking] = useState(false);

  const approve = useMutation({
    meta: { success: 'Question approved.' },
    mutationFn: () => api.admin.questions.setStatus(id, { status: QUESTION_STATUS.ACTIVE }),
    onSuccess: async () => {
      setAsking(false);
      await queryClient.invalidateQueries({ queryKey: [...QUERY_KEYS.QUESTION, id] });
      await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.QUESTIONS });
    },
    onError: () => setAsking(false),
  });

  if (!can(FEATURE_KEYS.QUESTION_MANAGEMENT, PERMISSION_LEVELS.WRITE)) return null;

  return (
    <>
      <Button size="sm" onClick={() => setAsking(true)}>
        <Check aria-hidden />
        Approve
      </Button>

      <ConfirmDialog
        open={asking}
        onOpenChange={setAsking}
        loading={approve.isPending}
        // ui-copy-ok: consequence — a confirm names what it is about to do
        title="Approve this question?"
        description="It goes into the bank as ACTIVE and can be drawn into any paper built from now on. Approving does not put it into a paper that already exists."
        confirmLabel="Approve it"
        onConfirm={() => approve.mutate()}
      />
    </>
  );
}
