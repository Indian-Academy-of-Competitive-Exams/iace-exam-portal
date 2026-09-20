import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil } from 'lucide-react';
import {
  ASSIGNMENT_ROLES,
  DEFAULT_LANGUAGE,
  FEATURE_KEYS,
  LANGUAGE_LABELS,
  LANGUAGE_ORDER,
  PERMISSION_LEVELS,
  instituteDayLabel,
  type QuestionLanguage,
} from '@iace/contracts';
import { PageCrumbs, useFilters } from '@iace/app-kit/browser';
import {
  Alert,
  Button,
  EmptyState,
  EMPTY_STATE_KINDS,
  PageFrame,
  PageHeader,
  SegmentedControl,
  SkeletonParagraph,
  plural,
} from '@iace/ui';
import { api } from '../lib/api';
import { NAV_ITEMS, QUERY_KEYS, ROUTES } from '../lib/constants';
import { useAuth } from '../providers/auth';
import { ProofreadQuestionBlock } from '../components/proofread-question';
import { SectionThreadButton } from '../components/section-thread';
import { SuperAdminOnly } from '../components/super-admin-only';
import { FinalizeAssignmentDialog } from './assignment-queue';

/** One section of one test, read top to bottom, with the fix in the reader's own hands. */

/** Reading is done one language at a time; all three at once is 150 blocks for a 50-question section. */
const EVERY_LANGUAGE = 'all';
const LANGUAGE_CHOICES = [
  ...LANGUAGE_ORDER.map((code) => ({
    value: code,
    label: code.toUpperCase(),
    name: LANGUAGE_LABELS[code],
  })),
  { value: EVERY_LANGUAGE, label: 'All', name: 'Every language' },
];

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

/** Everything a section is, from either key: who holds it, what it holds, and who is in it. */
function useSectionUnderReview(sectionKey: SectionKey) {
  const { identity } = useAuth();
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

  return {
    byAssignment,
    assignment,
    testId,
    sectionId,
    scoped,
    questions,
    elsewhere: editingBy && editingBy.adminId !== identity?.id ? editingBy : null,
    refused: byAssignment && assignments.data !== undefined && assignment === null,
    loading: assignments.isLoading || questions.isLoading,
    sectionName:
      assignment?.sectionName ??
      test.data?.baseConfig.sections.find((one) => one.id === sectionId)?.name ??
      'Section',
    testTitle: assignment?.testTitle ?? test.data?.title ?? null,
  };
}

type SectionUnderReview = ReturnType<typeof useSectionUnderReview>;

/** What is true of the section rather than of a question in it — each one silent until it is not. */
function ReadingNotices({ section }: Readonly<{ section: SectionUnderReview }>) {
  const { elsewhere, assignment, byAssignment, questions } = section;

  return (
    <>
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
    </>
  );
}

function SectionReading({ sectionKey }: Readonly<{ sectionKey: SectionKey }>) {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const [finalizing, setFinalizing] = useState(false);

  const section = useSectionUnderReview(sectionKey);
  const { byAssignment, assignment, testId, sectionId, scoped, questions } = section;

  const rows = questions.data ?? [];
  const canWrite = can(FEATURE_KEYS.QUESTION_PROOFREAD, PERMISSION_LEVELS.WRITE);
  const shown = useShownLanguages();
  const canEdit = byAssignment
    ? assignment !== null && assignment.finalizedAt === null && canWrite
    : scoped;

  const header = (
    <PageHeader
      breadcrumbs={<PageCrumbs nav={NAV_ITEMS} tail={[{ label: section.sectionName }]} />}
      title={section.sectionName}
      meta={metaOf(section.testTitle, questions.data?.length)}
      action={
        <>
          {scoped ? (
            <SectionThreadButton testId={testId} sectionId={sectionId} canWrite={canWrite} />
          ) : null}
          {canEdit && byAssignment ? (
            <Button size="sm" onClick={() => setFinalizing(true)}>
              Mark read
            </Button>
          ) : null}
        </>
      }
    />
  );

  if (section.refused) {
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
        {rows.length > 0 ? (
          <div data-print-hide className="flex justify-end">
            <SegmentedControl
              value={shown.choice}
              onChange={shown.choose}
              aria-label="Language"
              items={LANGUAGE_CHOICES}
            />
          </div>
        ) : null}

        <ReadingNotices section={section} />

        {section.loading ? <SkeletonParagraph lines={12} /> : null}

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
            languages={shown.languages}
            action={
              <Button asChild size="sm" variant="outline">
                <Link to={editHref(sectionKey, testId, sectionId, question.id)}>
                  <Pencil aria-hidden />
                  Edit
                </Link>
              </Button>
            }
          />
        ))}
      </section>

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

/** Rides the URL, so opening a question and coming back reads in the language you were reading. */
function useShownLanguages() {
  const filters = useFilters<'lang'>();
  const chosen = filters.get('lang');
  const choice = LANGUAGE_CHOICES.some((item) => item.value === chosen)
    ? (chosen as string)
    : DEFAULT_LANGUAGE;

  return {
    choice,
    choose: (value: string) => filters.set({ lang: value === DEFAULT_LANGUAGE ? '' : value }),
    languages:
      choice === EVERY_LANGUAGE ? LANGUAGE_ORDER : ([choice] as readonly QuestionLanguage[]),
  };
}

function metaOf(testTitle: string | null, count: number | undefined) {
  const title = testTitle ?? 'Untitled test';

  return count === undefined ? title : `${title} · ${plural(count, 'question')}`;
}

/** Whichever key the section was opened on is the key its questions are edited under. */
function editHref(
  sectionKey: SectionKey,
  testId: string,
  sectionId: string,
  questionId: string,
): string {
  return sectionKey.assignmentId !== ''
    ? ROUTES.PROOFREADING_QUESTION(sectionKey.assignmentId, questionId)
    : ROUTES.PROOFREADING_SECTION_QUESTION(testId, sectionId, questionId);
}
