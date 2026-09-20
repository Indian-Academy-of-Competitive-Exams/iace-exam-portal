import { useEffect, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { type QuestionDraftInput, type QuestionOnOtherTest } from '@iace/contracts';
import { applyFieldErrors, bannerMessage } from '@iace/app-kit';
import { PageCrumbs } from '@iace/app-kit/browser';
import {
  Alert,
  Button,
  EmptyState,
  EMPTY_STATE_KINDS,
  FormPanel,
  PageHeader,
  Skeleton,
  SkeletonParagraph,
} from '@iace/ui';
import { api } from '../lib/api';
import { NAV_ITEMS, QUERY_KEYS, ROUTES } from '../lib/constants';
import { QuestionFields } from '../components/question-fields';
import { SuperAdminOnly } from '../components/super-admin-only';
import {
  SERVER_FIELDS,
  emptyValues,
  toDraft,
  valuesOf,
  type QuestionFormValues,
} from '../components/question-draft';

/** One question of a section, edited with the room a question needs — spec §8. */

interface QuestionKey {
  assignmentId: string;
  testId: string;
  sectionId: string;
  questionId: string;
}

export function ProofreadingQuestionPage() {
  const params = useParams<{
    assignmentId?: string;
    testId?: string;
    sectionId?: string;
    questionId?: string;
  }>();
  const key: QuestionKey = {
    assignmentId: params.assignmentId ?? '',
    testId: params.testId ?? '',
    sectionId: params.sectionId ?? '',
    questionId: params.questionId ?? '',
  };

  if (key.assignmentId !== '') return <Editing questionKey={key} />;

  return (
    <SuperAdminOnly title="Question">
      <Editing questionKey={key} />
    </SuperAdminOnly>
  );
}

/** One pair of calls, whichever key the question was opened on — the authority is the route's. */
function readerFor({ assignmentId, testId, sectionId, questionId }: QuestionKey) {
  if (assignmentId !== '') {
    return {
      back: ROUTES.PROOFREADING_SECTION(assignmentId),
      detail: () => api.admin.proofreading.oneQuestion(assignmentId, questionId),
      otherTests: () => api.admin.proofreading.otherTests(assignmentId, questionId),
      save: (draft: QuestionDraftInput) =>
        api.admin.proofreading.editQuestion(assignmentId, questionId, draft),
    };
  }
  return {
    back: ROUTES.PROOFREADING_OF_SECTION(testId, sectionId),
    detail: () => api.admin.proofreading.oneSectionQuestion(testId, sectionId, questionId),
    otherTests: () => api.admin.proofreading.sectionOtherTests(testId, sectionId, questionId),
    save: (draft: QuestionDraftInput) =>
      api.admin.proofreading.editSectionQuestion(testId, sectionId, questionId, draft),
  };
}

function Editing({ questionKey }: Readonly<{ questionKey: QuestionKey }>) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const reader = useMemo(() => readerFor(questionKey), [questionKey]);
  const { questionId } = questionKey;

  const question = useQuery({
    queryKey: [...QUERY_KEYS.PROOFREADING, 'question', questionId],
    queryFn: reader.detail,
    retry: false,
  });

  const elsewhere = useQuery({
    queryKey: [...QUERY_KEYS.PROOFREADING, 'other-tests', questionId],
    queryFn: reader.otherTests,
  });

  const form = useForm<QuestionFormValues>({ defaultValues: emptyValues() });

  // Reset rather than key the form off it, so a refetch cannot throw away a half-typed fix.
  const loaded = question.data;
  useEffect(() => {
    if (loaded) form.reset(valuesOf(loaded));
  }, [loaded, form]);

  const save = useMutation({
    meta: { success: 'Question saved.', fields: [...SERVER_FIELDS] },
    mutationFn: (values: QuestionFormValues) => reader.save(toDraft(values, loaded)),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.PROOFREADING });
      navigate(reader.back);
    },
    onError: (error) => applyFieldErrors(error, form.setError, [...SERVER_FIELDS]),
  });

  const banner = bannerMessage(save.error, [...SERVER_FIELDS]);

  const header = (
    <PageHeader
      breadcrumbs={<PageCrumbs nav={NAV_ITEMS} tail={[{ label: 'Question' }]} />}
      title={loaded?.questionCode ?? 'Question'}
      meta={loaded ? `${loaded.subject.name} · Version ${loaded.version}` : undefined}
    />
  );

  if (question.isLoading) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton variant="title" />
        <SkeletonParagraph lines={6} />
      </div>
    );
  }

  if (question.isError || !loaded) {
    return (
      <EmptyState
        kind={EMPTY_STATE_KINDS.FAILURE}
        title="Could not load this question"
        onRetry={question.refetch}
      />
    );
  }

  return (
    <FormPanel
      onSubmit={form.handleSubmit((values) => save.mutate(values))}
      footer={
        <>
          <Button type="button" variant="outline" onClick={() => navigate(reader.back)}>
            Cancel
          </Button>
          <Button type="submit" loading={save.isPending}>
            Save question
          </Button>
        </>
      }
      header={
        <>
          {header}
          {banner ? <Alert variant="danger">{banner}</Alert> : null}
          <CrossTestWarning loading={elsewhere.isLoading} tests={elsewhere.data ?? []} />
        </>
      }
    >
      <QuestionFields form={form} saved={loaded} />
    </FormPanel>
  );
}

const TEST_NAMES = new Intl.ListFormat('en-IN', { style: 'long', type: 'conjunction' });

/** "Untitled test" rather than a blank: an unnamed test is still a test somebody has to decide about. */
const nameOf = (test: QuestionOnOtherTest): string => {
  const title = test.testTitle ?? 'Untitled test';
  return test.underReview ? `${title} (still under review)` : title;
};

/** Silent when nothing else holds the question, which is what makes it worth reading. */
export function CrossTestWarning({
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
