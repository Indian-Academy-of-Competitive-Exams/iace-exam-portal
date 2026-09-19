import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil } from 'lucide-react';
import {
  ASSIGNMENT_ROLES,
  FEATURE_KEYS,
  PERMISSION_LEVELS,
  instituteDayLabel,
  type QuestionDetail,
  type QuestionDraftInput,
  type QuestionOnOtherTest,
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
import { SectionThread } from '../components/section-thread';
import { SuperAdminOnly } from '../components/super-admin-only';
import { QuestionFields } from '../components/question-fields';
import {
  SERVER_FIELDS,
  toDraft,
  valuesOf,
  type QuestionFormValues,
} from '../components/question-draft';
import { FinalizeAssignmentDialog } from './assignment-queue';

/** One section of one test, read top to bottom, with the fix in the reader's own hands. */

/** The two ways in: the assignment that handed the section over, or the section's own pair. */
interface SectionKey {
  assignmentId: string;
  testId: string;
  sectionId: string;
}

export function ProofreadingSectionPage() {
  const params = useParams<{ assignmentId?: string; testId?: string; sectionId?: string }>();
  const key: SectionKey = {
    assignmentId: params.assignmentId ?? '',
    testId: params.testId ?? '',
    sectionId: params.sectionId ?? '',
  };

  if (key.assignmentId !== '') return <SectionReading sectionKey={key} />;

  return (
    <SuperAdminOnly title="Section">
      <SectionReading sectionKey={key} />
    </SuperAdminOnly>
  );
}

function SectionReading({ sectionKey }: Readonly<{ sectionKey: SectionKey }>) {
  const { can, identity } = useAuth();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<QuestionDetail | null>(null);
  const [finalizing, setFinalizing] = useState(false);

  const byAssignment = sectionKey.assignmentId !== '';

  const assignments = useQuery({
    queryKey: [...QUERY_KEYS.ASSIGNMENTS, 'one', sectionKey.assignmentId],
    queryFn: () => api.admin.assignments.one(sectionKey.assignmentId),
    enabled: byAssignment,
  });
  const assignment = assignments.data ?? null;

  // Only the section's own pair arrives in the URL, so the two names come off the test itself.
  const test = useQuery({
    queryKey: [...QUERY_KEYS.TEST, sectionKey.testId],
    queryFn: () => api.admin.tests.detail(sectionKey.testId),
    enabled: !byAssignment && sectionKey.testId !== '',
  });

  const testId = assignment?.testId ?? sectionKey.testId;
  const sectionId = assignment?.baseConfigSectionId ?? sectionKey.sectionId;
  const scoped = testId !== '' && sectionId !== '';

  const questions = useQuery({
    queryKey: [...QUERY_KEYS.PROOFREADING, 'section', testId, sectionId],
    queryFn: () =>
      byAssignment
        ? api.admin.proofreading.forAssignment(sectionKey.assignmentId)
        : api.admin.proofreading.forSection(testId, sectionId),
    enabled: byAssignment ? assignment !== null : scoped,
  });

  const lock = useQuery({
    queryKey: [...QUERY_KEYS.ASSIGNMENTS, 'lock', testId, sectionId],
    queryFn: () => api.admin.assignments.sectionLock(testId, sectionId),
    enabled: scoped,
  });
  const editingBy = lock.data?.editingBy ?? null;
  const elsewhere = editingBy && editingBy.adminId !== identity?.id ? editingBy : null;

  const sectionName =
    assignment?.sectionName ??
    test.data?.baseConfig.sections.find((one) => one.id === sectionId)?.name ??
    'Section';
  const testTitle = assignment?.testTitle ?? test.data?.title ?? null;

  const rows = questions.data ?? [];
  const canWrite = can(FEATURE_KEYS.QUESTION_PROOFREAD, PERMISSION_LEVELS.WRITE);
  const canEdit = byAssignment
    ? assignment !== null && assignment.finalizedAt === null && canWrite
    : scoped;

  const header = (
    <PageHeader
      breadcrumbs={<PageCrumbs nav={NAV_ITEMS} tail={[{ label: sectionName }]} />}
      title={sectionName}
      meta={metaOf(testTitle, questions.data?.length)}
      action={
        canEdit && byAssignment ? (
          <Button size="sm" onClick={() => setFinalizing(true)}>
            Mark read
          </Button>
        ) : null
      }
    />
  );

  if (byAssignment && assignments.data !== undefined && assignment === null) {
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
      {scoped ? (
        <div data-print-hide className="mb-8">
          <SectionThread testId={testId} sectionId={sectionId} canWrite={canWrite} />
        </div>
      ) : null}

      <section data-print-document className="flex flex-col gap-8">
        {elsewhere ? (
          <Alert variant="warning">
            {`${elsewhere.fullName ?? 'Another admin'} is editing this section. Their changes have to land first.`}
          </Alert>
        ) : null}

        {assignment?.finalizedAt ? (
          <Alert variant="info">
            {`You marked this section read on ${instituteDayLabel(assignment.finalizedAt)}. Its questions are no longer yours to change.`}
          </Alert>
        ) : null}

        {!byAssignment && questions.data ? (
          <Alert variant="info">
            Nobody has been given this section to proof-read. Reading it here assigns it to nobody.
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
          sectionKey={{ ...sectionKey, testId, sectionId }}
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

function metaOf(testTitle: string | null, count: number | undefined) {
  const title = testTitle ?? 'Untitled test';

  return count === undefined ? title : `${title} · ${plural(count, 'question')}`;
}

/** One pair of calls, whichever key the section was opened on — the authority is the route's. */
function readerFor(sectionKey: SectionKey) {
  const { assignmentId, testId, sectionId } = sectionKey;
  if (assignmentId !== '') {
    return {
      otherTests: (questionId: string) =>
        api.admin.proofreading.otherTests(assignmentId, questionId),
      edit: (questionId: string, draft: QuestionDraftInput) =>
        api.admin.proofreading.editQuestion(assignmentId, questionId, draft),
    };
  }
  return {
    otherTests: (questionId: string) =>
      api.admin.proofreading.sectionOtherTests(testId, sectionId, questionId),
    edit: (questionId: string, draft: QuestionDraftInput) =>
      api.admin.proofreading.editSectionQuestion(testId, sectionId, questionId, draft),
  };
}

function EditQuestionDialog({
  sectionKey,
  question,
  onClose,
  onSaved,
}: Readonly<{
  sectionKey: SectionKey;
  question: QuestionDetail;
  onClose: () => void;
  onSaved: () => void;
}>) {
  const form = useForm<QuestionFormValues>({ defaultValues: valuesOf(question) });
  const reader = useMemo(() => readerFor(sectionKey), [sectionKey]);

  const elsewhere = useQuery({
    queryKey: [...QUERY_KEYS.PROOFREADING, 'other-tests', sectionKey.testId, question.id],
    queryFn: () => reader.otherTests(question.id),
  });

  const save = useMutation({
    meta: { success: 'Question saved.', fields: [...SERVER_FIELDS] },
    mutationFn: (values: QuestionFormValues) => reader.edit(question.id, toDraft(values, question)),
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
      <CrossTestWarning loading={elsewhere.isLoading} tests={elsewhere.data ?? []} />

      <QuestionFields form={form} saved={question} />
    </FormDialog>
  );
}

const TEST_NAMES = new Intl.ListFormat('en-IN', { style: 'long', type: 'conjunction' });

/** "Untitled test" rather than a blank: an unnamed test is still a test somebody has to decide about. */
const nameOf = (test: QuestionOnOtherTest): string => {
  const title = test.testTitle ?? 'Untitled test';
  return test.underReview ? `${title} (still under review)` : title;
};

/** Silent when nothing else holds the question, which is what makes it worth reading. */
function CrossTestWarning({
  loading,
  tests,
}: Readonly<{ loading: boolean; tests: readonly QuestionOnOtherTest[] }>) {
  const [open, sharedOnly] = useMemo(
    () => [tests.filter((test) => test.isOpen), tests.filter((test) => !test.isOpen)],
    [tests],
  );

  if (loading) return <SkeletonParagraph lines={2} />;
  if (tests.length === 0) return null;

  return (
    <>
      {open.length > 0 ? (
        <Alert variant="warning">
          {`${TEST_NAMES.format(open.map(nameOf))} ${open.length === 1 ? 'has' : 'have'} already opened. A fix here appends a new version, and ${open.length === 1 ? 'that test keeps' : 'those tests keep'} the version its students were shown. Drop the question from it if that is not what you want.`}
        </Alert>
      ) : null}

      {sharedOnly.length > 0 ? (
        <Alert variant="info">
          {`This question is also on ${TEST_NAMES.format(sharedOnly.map(nameOf))}, ${sharedOnly.length === 1 ? 'which has not' : 'none of which have'} opened. A fix here changes it there too.`}
        </Alert>
      ) : null}
    </>
  );
}
