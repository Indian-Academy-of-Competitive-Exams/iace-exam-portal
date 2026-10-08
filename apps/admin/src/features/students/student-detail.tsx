import type * as React from 'react';
import { useEffect, useState, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm, useWatch, type UseFormReturn } from 'react-hook-form';
import { FileText, Pencil, Save } from 'lucide-react';
import {
  EARLIEST_BIRTH_DATE,
  examsInCourses,
  FEATURE_KEYS,
  GENDERS,
  PERMISSION_LEVELS,
  STUDENT_TYPE,
  STUDENT_TYPES,
  todayISO,
  type ExamCourse,
  type Gender,
  type StudentDetail,
  type UpdateStudentBody,
  type StudentType,
} from '@iace/contracts';
import {
  Alert,
  Avatar,
  Badge,
  Button,
  Combobox,
  DatePicker,
  EMPTY_STATE_KINDS,
  EmptyState,
  Field,
  FieldRow,
  FormCombobox,
  FormField,
  FormPanel,
  FormSection,
  Input,
  MultiCombobox,
  PageFrame,
  PageHeader,
  Skeleton,
  SkeletonParagraph,
} from '@iace/ui';
import { api } from '../../lib/api';
import {
  COURSE_ITEMS,
  GENDER_LABELS,
  NAV_ITEMS,
  QUERY_KEYS,
  STUDENT_TYPE_LABELS,
  studentQueryKey,
} from '../../lib/constants';
import { STUDENT_DETAIL_TOUR, TOUR_IDS, TOUR_TARGETS } from '../../lib/tours';
import { useBranchChoice, useBranches } from '../../lib/use-branches';
import { useExams } from './use-exams';
import { useAuth } from '../../providers/auth';
import { applyFieldErrors, bannerMessage } from '@iace/app-kit';
import { PageCrumbs, useFilters, usePageTour } from '@iace/app-kit/browser';
import { ProgramMultiPicker } from '../../components/access-picker';
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

interface FormValues {
  fullName: string;
  studentType: StudentType;
  enrolledExams: string[];
  enrolledCourses: ExamCourse[];
  programs: string[];
  currentBranchId: string;
  motherName: string;
  fatherName: string;
  dob: string;
  email: string;
  address: string;
  gender: '' | Gender;
}

const FORM_FIELDS = [
  'fullName',
  'studentType',
  'enrolledExams',
  'enrolledCourses',
  'programs',
  'currentBranchId',
  'motherName',
  'fatherName',
  'dob',
  'email',
  'address',
  'gender',
] as const;

/** An empty input means "no value", which the API expresses as null. */
const orNull = (value: string) => (value.trim() === '' ? null : value.trim());

// Access fields are sent only when a save moves one; an online student's type always rides along, as saying it is what puts them in the online branch.
function accessPatch(
  values: FormValues,
  dirty: { studentType?: boolean; currentBranchId?: boolean },
): Pick<UpdateStudentBody, 'studentType' | 'currentBranchId'> {
  const online = values.studentType === STUDENT_TYPE.ONLINE;
  const branchPatch = () => {
    if (values.studentType === STUDENT_TYPE.NON_IACE) return { currentBranchId: null };
    if (!online && dirty.currentBranchId) {
      return { currentBranchId: orNull(values.currentBranchId) };
    }
    return {};
  };

  return {
    ...(dirty.studentType || online ? { studentType: values.studentType } : {}),
    ...branchPatch(),
  };
}

function toFormValues(student: StudentDetail): FormValues {
  return {
    fullName: student.fullName ?? '',
    studentType: student.studentType,
    enrolledExams: [...student.enrolledExams],
    enrolledCourses: [...student.enrolledCourses],
    programs: [...student.programs],
    currentBranchId: student.currentBranchId ?? '',
    motherName: student.profile?.motherName ?? '',
    fatherName: student.profile?.fatherName ?? '',
    dob: student.profile?.dob ?? '',
    email: student.profile?.email ?? '',
    address: student.profile?.address ?? '',
    gender: student.profile?.gender ?? '',
  };
}

/** One uploaded document. Opens in a new tab — these are short-lived signed links. */
function DocumentLink({ label, url }: Readonly<{ label: string; url?: string | null }>) {
  if (!url) {
    return <Badge variant="neutral">{label}: not uploaded</Badge>;
  }

  return (
    <Button variant="outline" size="sm" asChild>
      <a href={url} target="_blank" rel="noreferrer">
        <FileText aria-hidden />
        {label}
      </a>
    </Button>
  );
}

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

/** Where a student sits relative to the institute — the fields access resolves through. */
function AccessCard({ form }: Readonly<{ form: UseFormReturn<FormValues> }>) {
  // Unfiltered — an exam retired since they enrolled is offered only to take it off them.
  const { exams: everyExam } = useExams();
  const heldExams = form.formState.defaultValues?.enrolledExams ?? [];
  const exams = everyExam.filter((exam) => exam.isActive || heldExams.includes(exam.code));
  // Unfiltered — a student's branch may have since been retired, and must still resolve to a name, not the raw id.
  const { branches: allBranches } = useBranches();
  const enrolledExams = useWatch({ control: form.control, name: 'enrolledExams' }) ?? [];
  const enrolledCourses = useWatch({ control: form.control, name: 'enrolledCourses' }) ?? [];
  const programs = useWatch({ control: form.control, name: 'programs' }) ?? [];
  const studentType = useWatch({ control: form.control, name: 'studentType' });
  const currentBranchId = useWatch({ control: form.control, name: 'currentBranchId' }) ?? '';
  const branch = useBranchChoice(studentType, form.formState.defaultValues?.currentBranchId);
  const shownBranchId = branch.shownId ?? currentBranchId;
  const currentBranchName = allBranches.find((option) => option.id === shownBranchId)?.name;

  return (
    <FormSection title="Access">
      <div className="flex flex-col gap-4">
        <FormCombobox
          form={form}
          name="studentType"
          label="Student type"
          items={STUDENT_TYPES.map((value) => ({ value, label: STUDENT_TYPE_LABELS[value] }))}
        />

        <FormField form={form} name="enrolledCourses" label="Enrolled courses">
          {({ id, 'aria-describedby': describedBy, 'aria-invalid': invalid }) => (
            <MultiCombobox
              id={id}
              aria-describedby={describedBy}
              aria-invalid={invalid}
              value={enrolledCourses}
              onChange={(next) =>
                form.setValue('enrolledCourses', next as ExamCourse[], { shouldDirty: true })
              }
              items={COURSE_ITEMS}
              chips={false}
              placeholder="No courses yet"
              emptyLabel="No course matches that"
            />
          )}
        </FormField>

        <FormField form={form} name="enrolledExams" label="Enrolled exams">
          {({ id, 'aria-describedby': describedBy, 'aria-invalid': invalid }) => (
            <MultiCombobox
              id={id}
              aria-describedby={describedBy}
              aria-invalid={invalid}
              value={enrolledExams}
              onChange={(next) => form.setValue('enrolledExams', next, { shouldDirty: true })}
              items={examsInCourses(exams, enrolledCourses, enrolledExams).map((exam) => ({
                value: exam.code,
                label: exam.code,
                hint: exam.isActive ? exam.name : `${exam.name}, retired`,
              }))}
              chips={false}
              placeholder="No exams yet"
              emptyLabel="No exam matches that"
            />
          )}
        </FormField>

        <FormField form={form} name="programs" label="Programs">
          {({ id, 'aria-describedby': describedBy, 'aria-invalid': invalid }) => (
            <ProgramMultiPicker
              id={id}
              aria-describedby={describedBy}
              aria-invalid={invalid}
              value={programs}
              onChange={(next) => form.setValue('programs', next, { shouldDirty: true })}
              held={form.formState.defaultValues?.programs?.filter((code) => code !== undefined)}
              placeholder="No programs yet"
            />
          )}
        </FormField>

        <FormField
          form={form}
          name="currentBranchId"
          label="Current branch"
          // ui-copy-ok: rule — why the picker is locked, which a disabled control cannot say
          hint={branch.hint}
        >
          {({ id, 'aria-describedby': describedBy, 'aria-invalid': invalid }) => (
            <Combobox
              id={id}
              aria-describedby={describedBy}
              aria-invalid={invalid}
              disabled={branch.locked}
              value={shownBranchId}
              selectedLabel={currentBranchName}
              onChange={(next) => form.setValue('currentBranchId', next, { shouldDirty: true })}
              items={branch.branches.map((option) => ({ value: option.id, label: option.name }))}
              placeholder="Not recorded"
              emptyLabel="No branch matches that"
            />
          )}
        </FormField>

        {branch.droppedName ? (
          <Alert variant="warning">Saving drops their branch, {branch.droppedName}.</Alert>
        ) : null}
      </div>
    </FormSection>
  );
}

/** The one tab the form owns: everything Edit and Save reach. */
function DetailsTab({
  form,
  detail,
}: Readonly<{ form: UseFormReturn<FormValues>; detail: StudentDetail }>) {
  const dob = useWatch({ control: form.control, name: 'dob' }) ?? '';

  return (
    <>
      <FormSection title="Uploads">
        <div className="flex flex-wrap gap-2">
          <DocumentLink label="Passport photo" url={detail.profile?.photoUrl} />
          <DocumentLink label="Class 10 marksheet" url={detail.profile?.tenthMarksheetUrl} />
        </div>
      </FormSection>

      <div className="grid gap-8 lg:grid-cols-2">
        <FormSection title="Details">
          <div className="flex flex-col gap-4">
            <FormField form={form} name="fullName" label="Full name">
              {(control) => <Input {...control} />}
            </FormField>

            <FieldRow>
              <FormField form={form} name="motherName" label="Mother's name">
                {(control) => <Input {...control} />}
              </FormField>
              <FormField form={form} name="fatherName" label="Father's name">
                {(control) => <Input {...control} />}
              </FormField>
            </FieldRow>

            <FieldRow>
              <Field htmlFor="dob" label="Date of birth" error={form.formState.errors.dob?.message}>
                {/* Bounded both ends: a picker offering what the server refuses is a dead end. */}
                {(control) => (
                  <DatePicker
                    {...control}
                    min={EARLIEST_BIRTH_DATE}
                    max={todayISO()}
                    value={dob}
                    onChange={(next) => form.setValue('dob', next, { shouldDirty: true })}
                  />
                )}
              </Field>
              <FormCombobox
                form={form}
                name="gender"
                label="Gender"
                clearable
                placeholder="Not recorded"
                items={GENDERS.map((value) => ({ value, label: GENDER_LABELS[value] }))}
              />
            </FieldRow>

            <FormField form={form} name="email" label="Email">
              {(control) => <Input {...control} type="email" />}
            </FormField>

            <FormField form={form} name="address" label="Address">
              {(control) => <Input {...control} />}
            </FormField>
          </div>
        </FormSection>

        <AccessCard form={form} />
      </div>
    </>
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

export function StudentDetailPage() {
  const { id = '' } = useParams();
  const { can, identity } = useAuth();
  const canWrite = can(FEATURE_KEYS.STUDENT_MANAGEMENT, PERMISSION_LEVELS.WRITE);
  const queryClient = useQueryClient();
  const [isEditing, setIsEditing] = useState(false);

  // Not a filter, but the same store: the open tab is a URL key somebody can send.
  const filters = useFilters<'tab'>();
  const rights = { can, isSuperAdmin: identity?.isSuperAdmin ?? false };
  const tabs = studentTabsFor(rights);
  const tab = openStudentTab(filters.get('tab'), rights);
  const onDetails = tab === STUDENT_TABS.DETAILS;

  const student = useQuery({
    queryKey: studentQueryKey(id),
    queryFn: () => api.admin.students.detail(id),
  });

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

  // Seeded once per student: a refetch of the same one would wipe an in-progress edit.
  const seededId = useRef<string | null>(null);
  useEffect(() => {
    const loaded = student.data;
    if (!loaded || seededId.current === loaded.id) return;
    seededId.current = loaded.id;
    form.reset(toFormValues(loaded));
  }, [student.data, form]);

  const save = useMutation({
    meta: { success: 'Saved.', fields: FORM_FIELDS },
    mutationFn: (values: FormValues) =>
      api.admin.students.update(id, {
        fullName: orNull(values.fullName),
        ...accessPatch(values, form.formState.dirtyFields),
        // An omitted key means "leave it alone", which is true of a list nobody touched.
        ...(form.formState.dirtyFields.enrolledExams
          ? { enrolledExams: values.enrolledExams }
          : {}),
        ...(form.formState.dirtyFields.enrolledCourses
          ? { enrolledCourses: values.enrolledCourses }
          : {}),
        ...(form.formState.dirtyFields.programs ? { programs: values.programs } : {}),
        profile: {
          motherName: orNull(values.motherName),
          fatherName: orNull(values.fatherName),
          dob: orNull(values.dob),
          email: orNull(values.email),
          address: orNull(values.address),
          gender: values.gender === '' ? null : values.gender,
        },
      }),
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

  return (
    <FormPanel
      disabled={!isEditing}
      onSubmit={form.handleSubmit((values) => save.mutate(values))}
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
              disabled={!form.formState.isDirty}
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
                  onClick={() => setIsEditing(true)}
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
                    setIsEditing(true);
                  }
            }
          />
        </>
      }
    />
  );
}
