import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil } from 'lucide-react';
import {
  ASSIGNMENT_ROLES,
  FEATURE_KEYS,
  PERMISSION_LEVELS,
  instituteDayLabel,
  type AssignmentWithTest,
  type QuestionDetail,
} from '@iace/contracts';
import { applyFieldErrors } from '@iace/app-kit';
import { PageCrumbs } from '@iace/app-kit/browser';
import {
  Alert,
  Button,
  EmptyState,
  EMPTY_STATE_KINDS,
  FormDialog,
  PageFrame,
  PageHeader,
  SkeletonParagraph,
  plural,
} from '@iace/ui';
import { api } from '../lib/api';
import { NAV_ITEMS, QUERY_KEYS } from '../lib/constants';
import { useAuth } from '../providers/auth';
import { ProofreadQuestionBlock } from '../components/proofread-question';
import { QuestionFields } from '../components/question-fields';
import {
  SERVER_FIELDS,
  toDraft,
  valuesOf,
  type QuestionFormValues,
} from '../components/question-draft';
import { FinalizeAssignmentDialog } from './assignment-queue';

/** One section of one test, read top to bottom, with the fix in the reader's own hands. */
export function ProofreadingSectionPage() {
  const { assignmentId } = useParams<{ assignmentId: string }>();
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<QuestionDetail | null>(null);
  const [finalizing, setFinalizing] = useState(false);

  const id = assignmentId ?? '';
  const assignments = useQuery({
    queryKey: [...QUERY_KEYS.ASSIGNMENTS, 'mine', ASSIGNMENT_ROLES.PROOFREADER, null],
    queryFn: () => api.admin.assignments.mine({ role: ASSIGNMENT_ROLES.PROOFREADER }),
  });
  const assignment = assignments.data?.find((row) => row.id === id) ?? null;

  const questions = useQuery({
    queryKey: [...QUERY_KEYS.PROOFREADING, 'assignment', id],
    queryFn: () => api.admin.proofreading.forAssignment(id),
    enabled: assignment !== null,
  });

  const rows = questions.data ?? [];
  const canEdit =
    assignment !== null &&
    assignment.finalizedAt === null &&
    can(FEATURE_KEYS.QUESTION_PROOFREAD, PERMISSION_LEVELS.WRITE);

  const header = (
    <PageHeader
      breadcrumbs={
        <PageCrumbs nav={NAV_ITEMS} tail={[{ label: assignment?.sectionName ?? 'Section' }]} />
      }
      title={assignment?.sectionName ?? 'Section'}
      meta={metaOf(assignment, questions.data?.length)}
      action={
        canEdit ? (
          <Button size="sm" onClick={() => setFinalizing(true)}>
            Mark read
          </Button>
        ) : null
      }
    />
  );

  if (assignments.data !== undefined && assignment === null) {
    return (
      <PageFrame header={header}>
        <EmptyState
          kind={EMPTY_STATE_KINDS.REFUSED}
          title="This section is not yours to read"
          hint="Ask whoever builds the test to assign it to you."
        />
      </PageFrame>
    );
  }

  return (
    <PageFrame header={header}>
      <section data-print-document className="flex flex-col gap-8">
        {assignment?.finalizedAt ? (
          <Alert variant="info">
            {`You marked this section read on ${instituteDayLabel(assignment.finalizedAt)}. Its questions are no longer yours to change.`}
          </Alert>
        ) : null}

        {assignments.isLoading || questions.isLoading ? <SkeletonParagraph lines={12} /> : null}

        {questions.isError ? (
          <EmptyState
            kind={EMPTY_STATE_KINDS.FAILURE}
            title="Could not load this section"
            onRetry={questions.refetch}
          />
        ) : null}

        {questions.data && rows.length === 0 ? (
          <EmptyState kind={EMPTY_STATE_KINDS.EMPTY} title="No questions yet" />
        ) : null}

        {rows.map((question, index) => (
          <ProofreadQuestionBlock
            key={question.id}
            question={question}
            index={index + 1}
            canWrite={canEdit}
            action={
              <Button size="sm" variant="outline" onClick={() => setEditing(question)}>
                <Pencil aria-hidden />
                Edit
              </Button>
            }
          />
        ))}
      </section>

      {editing ? (
        <EditQuestionDialog
          assignmentId={id}
          question={editing}
          onClose={() => setEditing(null)}
          onSaved={() => void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.PROOFREADING })}
        />
      ) : null}

      <FinalizeAssignmentDialog
        role={ASSIGNMENT_ROLES.PROOFREADER}
        assignment={finalizing ? assignment : null}
        covering={rows.length}
        onClose={() => setFinalizing(false)}
        onFinalized={() => void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.ASSIGNMENTS })}
      />
    </PageFrame>
  );
}

function metaOf(assignment: AssignmentWithTest | null, count: number | undefined) {
  if (!assignment) return undefined;
  const title = assignment.testTitle ?? 'Untitled test';

  return count === undefined ? title : `${title} · ${plural(count, 'question')}`;
}

function EditQuestionDialog({
  assignmentId,
  question,
  onClose,
  onSaved,
}: Readonly<{
  assignmentId: string;
  question: QuestionDetail;
  onClose: () => void;
  onSaved: () => void;
}>) {
  const form = useForm<QuestionFormValues>({ defaultValues: valuesOf(question) });

  const save = useMutation({
    meta: { success: 'Question saved.', fields: [...SERVER_FIELDS] },
    mutationFn: (values: QuestionFormValues) =>
      api.admin.proofreading.editQuestion(assignmentId, question.id, toDraft(values, question)),
    onSuccess: () => {
      onSaved();
      onClose();
    },
    onError: (error) => applyFieldErrors(error, form.setError, [...SERVER_FIELDS]),
  });

  return (
    <FormDialog
      open
      onOpenChange={(open) => !open && onClose()}
      form={form}
      onSubmit={(values) => save.mutate(values)}
      title={`Edit ${question.questionCode ?? 'this question'}`}
      submitLabel="Save question"
      loading={save.isPending}
      size="lg"
    >
      <Alert variant="warning">
        A fix here changes the question wherever it is used. A test students can already reach keeps
        the version they were shown.
      </Alert>

      <QuestionFields form={form} saved={question} />
    </FormDialog>
  );
}
