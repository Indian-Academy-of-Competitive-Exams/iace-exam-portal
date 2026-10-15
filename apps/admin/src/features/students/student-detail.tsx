import type * as React from 'react';
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm, type UseFormReturn } from 'react-hook-form';
import { Pencil, Save } from 'lucide-react';
import { FEATURE_KEYS, PERMISSION_LEVELS, STUDENT_TYPE, type StudentDetail } from '@iace/contracts';
import {
  Alert,
  Avatar,
  Button,
  EMPTY_STATE_KINDS,
  EmptyState,
  FormPanel,
  PageFrame,
  PageHeader,
  Skeleton,
  SkeletonParagraph,
} from '@iace/ui';
import { api } from '../../lib/api';
import { NAV_ITEMS } from '../../lib/nav';
import { QUERY_KEYS, studentQueryKey } from '../../lib/query-keys';
import { STUDENT_DETAIL_TOUR, TOUR_IDS, TOUR_TARGETS } from '../../lib/tours';
import { useAuth } from '../../providers/auth';
import { applyFieldErrors, bannerMessage } from '@iace/app-kit';
import { PageCrumbs, useFilters, usePageTour } from '@iace/app-kit/browser';
import { StudentPerformancePanel } from './student-performance';
import { ActionsTab } from './student-detail-actions';
import { EventsTab } from './student-detail-events';
import { SeriesTab } from './student-detail-series';
import {
  openStudentTab,
  studentTabsFor,
  STUDENT_TABS,
  STUDENT_TAB_LABELS,
  type StudentTab,
} from './student-detail-tabs';
import { DetailsTab } from './student-detail-fields';
import {
  FIELD_LABELS,
  FORM_FIELDS,
  isStale,
  movedSince,
  patchOf,
  toFormValues,
  type FormValues,
} from './student-detail-values';

/** Everything outstanding, said once: a strip of chips makes the reader assemble what a sentence carries. */
function StudentStateNotice({
  detail,
  onAddPreTestDetails,
}: Readonly<{ detail: StudentDetail; onAddPreTestDetails?: () => void }>) {
  const notes = [
    !detail.isActive ? 'Sign-in is suspended, so they cannot sign in on any device.' : null,
    detail.isTestBlocked ? 'They cannot start a new test until the block is lifted.' : null,
    !detail.preTestReady
      ? "Mother's name, father's name and date of birth are needed before they can sit a test."
      : null,
    !detail.profileCompleted
      ? 'Their full profile is incomplete, which nudges them but blocks nothing.'
      : null,
  ].filter((note): note is string => note !== null);

  if (notes.length === 0) return null;

  return (
    <Alert variant={!detail.isActive || detail.isTestBlocked ? 'danger' : 'warning'}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span>{notes.join(' ')}</span>
        {!detail.preTestReady && onAddPreTestDetails ? (
          <Button type="button" variant="outline" size="sm" onClick={onAddPreTestDetails}>
            <Pencil aria-hidden />
            Add pre-test details
          </Button>
        ) : null}
      </div>
    </Alert>
  );
}

interface TabProps {
  form: UseFormReturn<FormValues>;
  detail: StudentDetail;
  canWrite: boolean;
}

/** One entry per tab, so a tab added to the list without a body is a type error. */
const TAB_CONTENT: Readonly<Record<StudentTab, (props: TabProps) => React.ReactNode>> = {
  [STUDENT_TABS.DETAILS]: ({ form, detail }) => <DetailsTab form={form} detail={detail} />,
  [STUDENT_TABS.SERIES]: ({ detail, canWrite }) => (
    <SeriesTab detail={detail} canWrite={canWrite} />
  ),
  [STUDENT_TABS.EVENTS]: ({ detail, canWrite }) => (
    <EventsTab detail={detail} canWrite={canWrite} />
  ),
  [STUDENT_TABS.PERFORMANCE]: ({ detail }) => (
    <StudentPerformancePanel key={detail.id} studentId={detail.id} />
  ),
  [STUDENT_TABS.ACTIONS]: ({ detail, canWrite }) => (
    <ActionsTab detail={detail} canWrite={canWrite} />
  ),
};

/** A fresh page for each student: an edit begun on one never carries over to the next. */
export function StudentDetailPage() {
  const { id = '' } = useParams();
  return <StudentDetailView key={id} id={id} />;
}

function StudentDetailView({ id }: Readonly<{ id: string }>) {
  const { can, identity } = useAuth();
  const canWrite = can(FEATURE_KEYS.STUDENT_MANAGEMENT, PERMISSION_LEVELS.WRITE);
  const queryClient = useQueryClient();
  const [isEditing, setIsEditing] = useState(false);
  // The record the open edit began on; what was written elsewhere since is measured against it.
  const [opened, setOpened] = useState<StudentDetail | null>(null);

  // Not a filter, but the same store: the open tab is a URL key somebody can send.
  const filters = useFilters<'tab'>();
  const rights = { can, isSuperAdmin: identity?.isSuperAdmin ?? false };
  const tabs = studentTabsFor(rights);
  const tab = openStudentTab(filters.get('tab'), rights);
  const onDetails = tab === STUDENT_TABS.DETAILS;

  const studentQuery = {
    queryKey: studentQueryKey(id),
    queryFn: () => api.admin.students.detail(id),
  };
  const student = useQuery(studentQuery);

  // Before the early returns below, and keyed on the query: the tabs it points at are a skeleton until then.
  usePageTour({
    id: TOUR_IDS.STUDENT_DETAIL,
    steps: STUDENT_DETAIL_TOUR,
    ready: student.isSuccess,
  });

  const form = useForm<FormValues>({
    defaultValues: {
      fullName: '',
      studentType: STUDENT_TYPE.ONLINE,
      enrolledExams: [],
      enrolledCourses: [],
      programs: [],
      currentBranchId: '',
      motherName: '',
      fatherName: '',
      dob: '',
      email: '',
      address: '',
      gender: '',
    },
  });

  // Follows the record until an edit starts: a re-read mid-edit must not wipe what was typed.
  const { reset } = form;
  useEffect(() => {
    if (student.data && !isEditing) reset(toFormValues(student.data));
  }, [student.data, reset, isEditing]);

  const save = useMutation({
    meta: { success: 'Saved.', fields: FORM_FIELDS },
    mutationFn: async () => {
      const patch = patchOf(form);
      // On the newest stamp while nothing this save writes has moved, else the one the edit began on, which is refused.
      const send = (latest: StudentDetail | undefined) =>
        api.admin.students.update(id, {
          ...patch,
          expectedUpdatedAt: (movedSince(patch, opened, latest).length === 0 ? latest : opened)
            ?.updatedAt,
        });
      try {
        return await send(student.data);
      } catch (error) {
        if (!isStale(error)) throw error;
        // A block, a mobile change or a save to other fields moves the stamp too, so the record is read again before giving up.
        const latest = await queryClient.fetchQuery({ ...studentQuery, staleTime: 0 });
        if (movedSince(patch, opened, latest).length > 0) throw error;
        return send(latest);
      }
    },
    onSuccess: (updated) => {
      void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.STUDENTS, refetchType: 'none' });
      queryClient.setQueryData(studentQueryKey(id), updated);
      form.reset(toFormValues(updated));
      setIsEditing(false);
    },
    onError: (error) => {
      applyFieldErrors(error, form.setError, FORM_FIELDS);
      // Bring the offending field into view; on a long form the message can otherwise land above the fold.
      requestAnimationFrame(() => {
        document
          .querySelector('[aria-invalid="true"], [role="alert"]')
          ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      });
    },
  });

  // Framed like the page it stands in for, so the scrollport does not appear only once data lands.
  if (student.isPending && !student.isPaused) {
    return (
      <PageFrame>
        <div className="flex flex-col gap-5">
          <Skeleton variant="title" />
          <SkeletonParagraph lines={3} />
          <SkeletonParagraph lines={5} />
        </div>
      </PageFrame>
    );
  }
  if (student.error || !student.data) {
    // The reason is on the toast; this only has to stop the page being blank.
    return (
      <PageFrame>
        <EmptyState
          kind={EMPTY_STATE_KINDS.FAILURE}
          title="Could not load this student"
          onRetry={student.refetch}
        />
      </PageFrame>
    );
  }

  const detail = student.data;
  const moved = isEditing ? movedSince(patchOf(form), opened, detail) : [];
  const edit = () => {
    setOpened(detail);
    setIsEditing(true);
  };

  return (
    <FormPanel
      disabled={!isEditing}
      onSubmit={form.handleSubmit(() => save.mutate())}
      tabs={{
        value: tab,
        onValueChange: (value) => filters.set({ tab: value }),
        items: tabs.map((value) => ({
          value,
          label: STUDENT_TAB_LABELS[value],
          standalone: value !== STUDENT_TABS.DETAILS,
          content: TAB_CONTENT[value]({ form, detail, canWrite }),
        })),
      }}
      footer={
        isEditing ? (
          <>
            {save.error && bannerMessage(save.error, FORM_FIELDS) === null ? (
              <Alert variant="danger">Check the highlighted fields above.</Alert>
            ) : null}
            {moved.length > 0 ? (
              <Alert variant="warning">
                Changed elsewhere since you began editing:{' '}
                {moved.map((field) => FIELD_LABELS[field]).join(', ')}. Discard, then edit again
                from the record as it stands.
              </Alert>
            ) : null}
            {/* Cancel is neutral grey, never red — it destroys nothing. */}
            <Button
              type="button"
              variant="secondary"
              disabled={save.isPending}
              onClick={() => {
                form.reset();
                save.reset();
                setIsEditing(false);
              }}
            >
              Discard
            </Button>
            <Button
              type="submit"
              icon={<Save aria-hidden />}
              loading={save.isPending}
              disabled={!form.formState.isDirty || moved.length > 0}
            >
              Save changes
            </Button>
          </>
        ) : undefined
      }
      header={
        <>
          <PageHeader
            breadcrumbs={
              <PageCrumbs nav={NAV_ITEMS} tail={[{ label: detail.fullName ?? detail.mobile }]} />
            }
            leading={
              <Avatar
                src={detail.profile?.photoUrl}
                name={detail.fullName}
                fallback={detail.mobile}
                size="md"
              />
            }
            title={detail.fullName ?? detail.mobile}
            meta={`+91 ${detail.mobile}`}
            action={
              canWrite && onDetails && !isEditing ? (
                <Button
                  data-tour={TOUR_TARGETS.STUDENT_EDIT}
                  variant="outline"
                  size="sm"
                  onClick={edit}
                >
                  <Pencil aria-hidden />
                  Edit details
                </Button>
              ) : undefined
            }
          />
          {/* Pinned above the strip, so a blocked student reads as one from whichever tab is open. */}
          <StudentStateNotice
            detail={detail}
            onAddPreTestDetails={
              isEditing || !canWrite
                ? undefined
                : () => {
                    filters.set({ tab: STUDENT_TABS.DETAILS });
                    edit();
                  }
            }
          />
        </>
      }
    />
  );
}
