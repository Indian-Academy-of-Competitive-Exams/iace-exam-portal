import { useEffect, useState } from 'react';
import { Pencil } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { applyFieldErrors, bannerMessage } from '@iace/app-kit';
import { PageCrumbs } from '@iace/app-kit/browser';
import { Alert, Button, FormPanel, PageHeader, Skeleton, SkeletonParagraph } from '@iace/ui';
import { api } from '../lib/api';
import { NAV_ITEMS, QUERY_KEYS, ROUTES } from '../lib/constants';
import { QuestionFields } from '../components/question-fields';
import { BankQuestionWindow } from '../components/authoring/bank-question-window';
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
  // A new question is typed here; one that already exists is read here and edited in the window.
  const isEditing = !existing;
  const [windowOpen, setWindowOpen] = useState(false);

  const question = useQuery({
    queryKey: [...QUERY_KEYS.QUESTION, id],
    queryFn: () => api.admin.questions.detail(questionId),
    enabled: existing,
  });

  const form = useForm<QuestionFormValues>({ defaultValues: emptyValues() });

  // The saved question arrives after first render; reset rather than key the form off it, so a refetch can't discard a half-typed edit.
  const loaded = question.data;
  useEffect(() => {
    if (loaded) form.reset(valuesOf(loaded));
  }, [loaded, form]);

  const save = useMutation({
    meta: { success: 'Question added.' },
    mutationFn: (values: QuestionFormValues) => api.admin.questions.create(toDraft(values)),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.QUESTIONS });
      navigate(ROUTES.QUESTIONS);
    },
    onError: (error) => applyFieldErrors(error, form.setError, [...SERVER_FIELDS]),
  });

  const banner = bannerMessage(save.error, [...SERVER_FIELDS]);

  const title = existing ? 'Question' : 'New question';

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
            <Button type="button" variant="outline" onClick={() => navigate(ROUTES.QUESTIONS)}>
              Cancel
            </Button>
            <Button type="submit" loading={save.isPending}>
              Add question
            </Button>
          </>
        ) : undefined
      }
      header={
        <>
          <PageHeader
            breadcrumbs={<PageCrumbs nav={NAV_ITEMS} />}
            title={title}
            action={existing ? <EditAction onEdit={() => setWindowOpen(true)} /> : null}
          />

          {banner ? <Alert variant="danger">{banner}</Alert> : null}
        </>
      }
    >
      <QuestionFields form={form} saved={loaded} />
      {existing ? (
        <BankQuestionWindow
          questionId={questionId}
          open={windowOpen}
          onOpenChange={setWindowOpen}
        />
      ) : null}
    </FormPanel>
  );
}

function EditAction({ onEdit }: Readonly<{ onEdit: () => void }>) {
  return (
    <Button variant="outline" size="sm" onClick={onEdit}>
      <Pencil aria-hidden />
      Edit question
    </Button>
  );
}
