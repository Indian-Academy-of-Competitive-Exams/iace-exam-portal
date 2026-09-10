import type * as React from 'react';
import { useEffect, useState, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm, useWatch, type UseFormReturn } from 'react-hook-form';
import { FileText, Pencil, Save } from 'lucide-react';
import {
  EARLIEST_BIRTH_DATE,
  EXAM_COURSES,
  examsInCourses,
  GENDERS,
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
  EmptyState,
  EMPTY_STATE_KINDS,
  Field,
  FormPanel,
  FormSection,
  Input,
  MultiCombobox,
  PageFrame,
  PageHeader,
  Skeleton,
  SkeletonParagraph,
} from '@iace/ui';
import { api } from '../lib/api';
import {
  courseLabel,
  GENDER_LABELS,
  NAV_ITEMS,
  QUERY_KEYS,
  STUDENT_TYPE_LABELS,
} from '../lib/constants';
import { useBranchChoice, useBranches } from '../lib/use-branches';
import { useExams } from '../lib/use-exams';
import { useAuth } from '../providers/auth';
import { applyFieldErrors } from '@iace/app-kit';
import { PageCrumbs, useFilters } from '@iace/app-kit/browser';
import { SharedReportsCard } from '../components/shared-reports';
import { StudentPerformancePanel } from '../components/student-performance';
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

/**
 * The two access fields, sent only when this save actually moves one — the server checks the pair
 * as the save would LEAVE it, so a student stored out of agreement before the rule existed stays
 * renameable. `forcedBranchId` is the branch a locked picker stands on: the admin never touched it,
 * but it is what they are looking at, so it is what the save carries.
 */
function accessPatch(
  values: FormValues,
  dirty: { studentType?: boolean; currentBranchId?: boolean },
  forcedBranchId: string | undefined,
): Pick<UpdateStudentBody, 'studentType' | 'currentBranchId'> {
  const branchPatch = () => {
    if (forcedBranchId !== undefined) return { currentBranchId: forcedBranchId };
    if (dirty.currentBranchId) return { currentBranchId: orNull(values.currentBranchId) };
    return {};
  };

  return {
    ...(dirty.studentType ? { studentType: values.studentType } : {}),
    ...branchPatch(),
  };
}

function toFormValues(student: StudentDetail): FormValues {
  return {
    fullName: student.fullName ?? '',
    studentType: student.studentType,
    enrolledExams: [...student.enrolledExams],
    enrolledCourses: [...student.enrolledCourses],
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
    return <Badge variant="neutral">{label} — not uploaded</Badge>;
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

/** The sign-in state as a value the header carries; what is WRONG with it belongs in the notice. */
function signInSummary(detail: StudentDetail): string {
  return detail.hasSignedIn ? 'Has signed in' : 'Never signed in';
}

/** Everything outstanding, said once: a strip of chips makes the reader assemble what a sentence carries. */
function StudentStateNotice({
  detail,
  onAddPreTestDetails,
}: Readonly<{ detail: StudentDetail; onAddPreTestDetails?: () => void }>) {
  const notes = [
    !detail.isActive ? 'Sign-in is suspended, so they cannot sign in on any device.' : null,
    detail.isTestBlocked ? 'They cannot start a new test until the block is lifted.' : null,
    detail.hasDefaultPin ? 'They are still on the default PIN.' : null,
    !detail.preTestReady
      ? "Mother's name, father's name and date of birth are needed before they can sit a test."
      : null,
    !detail.profileCompleted
      ? 'Their full profile is incomplete, which nudges them but blocks nothing.'
      : null,
  ].filter((note): note is string => note !== null);

  if (notes.length === 0) return null;

  return (
    <Alert
      variant={!detail.isActive || detail.isTestBlocked ? 'danger' : 'warning'}
      className="mb-4"
    >
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

/** Where a student sits relative to the institute — the four fields access resolves through. */
function AccessCard({ form }: Readonly<{ form: UseFormReturn<FormValues> }>) {
  const exams = useExams({ activeOnly: true });
  // Unfiltered: a student's current branch can be one that has since been retired, and
  // it must still resolve to a name rather than the raw id the active list no longer carries.
  const allBranches = useBranches();
  const enrolledExams = useWatch({ control: form.control, name: 'enrolledExams' }) ?? [];
  const enrolledCourses = useWatch({ control: form.control, name: 'enrolledCourses' }) ?? [];
  const studentType = useWatch({ control: form.control, name: 'studentType' });
  const branch = useBranchChoice(studentType);
  const currentBranchId = useWatch({ control: form.control, name: 'currentBranchId' }) ?? '';
  // Displayed AND submitted, so a locked picker can never show one branch and save another.
  const chosenBranchId = branch.locked ? (branch.forcedId ?? '') : currentBranchId;
  const currentBranchName = allBranches.find((option) => option.id === chosenBranchId)?.name;

  return (
    <FormSection title="Access">
      <div className="flex flex-col gap-4">
        <Field
          htmlFor="studentType"
          label="Student type"
          error={form.formState.errors.studentType?.message}
        >
          {(control) => (
            <Combobox
              id={control.id}
              aria-describedby={control['aria-describedby']}
              aria-invalid={control['aria-invalid']}
              clearable={false}
              value={studentType}
              onChange={(next) =>
                form.setValue('studentType', next as StudentType, { shouldDirty: true })
              }
              items={STUDENT_TYPES.map((value) => ({
                value,
                label: STUDENT_TYPE_LABELS[value],
              }))}
            />
          )}
        </Field>

        <Field
          htmlFor="enrolledCourses"
          label="Enrolled courses"
          error={form.formState.errors.enrolledCourses?.message}
        >
          {({ id, 'aria-describedby': describedBy, 'aria-invalid': invalid }) => (
            <MultiCombobox
              id={id}
              aria-describedby={describedBy}
              aria-invalid={invalid}
              value={enrolledCourses}
              onChange={(next) =>
                form.setValue('enrolledCourses', next as ExamCourse[], { shouldDirty: true })
              }
              items={EXAM_COURSES.map((course) => ({
                value: course,
                label: courseLabel(course),
              }))}
              chips={false}
              placeholder="No courses yet"
              emptyLabel="No course matches that"
            />
          )}
        </Field>

        <Field
          htmlFor="enrolledExams"
          label="Enrolled exams"
          error={form.formState.errors.enrolledExams?.message}
        >
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
                hint: exam.name,
              }))}
              chips={false}
              placeholder="No exams yet"
              emptyLabel="No exam matches that"
            />
          )}
        </Field>

        <Field
          htmlFor="currentBranchId"
          label="Current branch"
          // ui-copy-ok: rule — why the picker is locked, which a disabled control cannot say
          hint={branch.hint}
          error={form.formState.errors.currentBranchId?.message}
        >
          {({ id, 'aria-describedby': describedBy, 'aria-invalid': invalid }) => (
            <Combobox
              id={id}
              aria-describedby={describedBy}
              aria-invalid={invalid}
              disabled={branch.locked}
              value={chosenBranchId}
              selectedLabel={currentBranchName}
              onChange={(next) => form.setValue('currentBranchId', next, { shouldDirty: true })}
              items={branch.branches.map((option) => ({ value: option.id, label: option.name }))}
              placeholder="Not recorded"
              emptyLabel="No branch matches that"
            />
          )}
        </Field>
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
  const gender = useWatch({ control: form.control, name: 'gender' }) ?? '';

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
            <Field
              htmlFor="fullName"
              label="Full name"
              error={form.formState.errors.fullName?.message}
            >
              {(control) => <Input {...control} {...form.register('fullName')} />}
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                htmlFor="motherName"
                label="Mother's name"
                error={form.formState.errors.motherName?.message}
              >
                {(control) => <Input {...control} {...form.register('motherName')} />}
              </Field>
              <Field
                htmlFor="fatherName"
                label="Father's name"
                error={form.formState.errors.fatherName?.message}
              >
                {(control) => <Input {...control} {...form.register('fatherName')} />}
              </Field>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
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
              <Field htmlFor="gender" label="Gender" error={form.formState.errors.gender?.message}>
                {(control) => (
                  <Combobox
                    id={control.id}
                    aria-describedby={control['aria-describedby']}
                    aria-invalid={control['aria-invalid']}
                    value={gender}
                    placeholder="Not recorded"
                    onChange={(next) =>
                      form.setValue('gender', next as FormValues['gender'], { shouldDirty: true })
                    }
                    items={GENDERS.map((value) => ({ value, label: GENDER_LABELS[value] }))}
                  />
                )}
              </Field>
            </div>

            <Field htmlFor="email" label="Email" error={form.formState.errors.email?.message}>
              {(control) => <Input {...control} type="email" {...form.register('email')} />}
            </Field>

            <Field htmlFor="address" label="Address" error={form.formState.errors.address?.message}>
              {(control) => <Input {...control} {...form.register('address')} />}
            </Field>
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
}

/** One entry per tab, so a tab added to the list without a body is a type error. */
const TAB_CONTENT: Readonly<Record<StudentTab, (props: TabProps) => React.ReactNode>> = {
  [STUDENT_TABS.DETAILS]: ({ form, detail }) => <DetailsTab form={form} detail={detail} />,
  [STUDENT_TABS.SERIES]: ({ detail }) => <SeriesTab detail={detail} />,
  [STUDENT_TABS.EVENTS]: ({ detail }) => <EventsTab detail={detail} />,
  [STUDENT_TABS.PERFORMANCE]: ({ detail }) => (
    <>
      <StudentPerformancePanel studentId={detail.id} />
      <SharedReportsCard studentId={detail.id} name={detail.fullName ?? detail.mobile} />
    </>
  ),
  [STUDENT_TABS.ACTIONS]: ({ detail }) => <ActionsTab detail={detail} />,
};

export function StudentDetailPage() {
  const { id = '' } = useParams();
  const { can, identity } = useAuth();
  const queryClient = useQueryClient();
  const [isEditing, setIsEditing] = useState(false);

  // Not a filter, but the same store: the open tab is a URL key somebody can send.
  const filters = useFilters<'tab'>();
  const rights = { can, isSuperAdmin: identity?.isSuperAdmin ?? false };
  const tabs = studentTabsFor(rights);
  const tab = openStudentTab(filters.get('tab'), rights);
  const onDetails = tab === STUDENT_TABS.DETAILS;

  const student = useQuery({
    queryKey: [...QUERY_KEYS.STUDENT, id],
    queryFn: () => api.admin.students.detail(id),
  });

  const form = useForm<FormValues>({
    defaultValues: {
      fullName: '',
      studentType: STUDENT_TYPE.ONLINE,
      enrolledExams: [],
      enrolledCourses: [],
      currentBranchId: '',
      motherName: '',
      fatherName: '',
      dob: '',
      email: '',
      address: '',
      gender: '',
    },
  });

  // useWatch, not form.watch: a fresh function each render re-renders the picker on every keystroke.
  // The same choice the Access card renders, so the save cannot send what the picker never showed.
  const branch = useBranchChoice(useWatch({ control: form.control, name: 'studentType' }));
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
        ...accessPatch(values, form.formState.dirtyFields, branch.forcedId),
        // An omitted key means "leave it alone", which is true of a list nobody touched.
        ...(form.formState.dirtyFields.enrolledExams
          ? { enrolledExams: values.enrolledExams }
          : {}),
        ...(form.formState.dirtyFields.enrolledCourses
          ? { enrolledCourses: values.enrolledCourses }
          : {}),
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
      queryClient.setQueryData([...QUERY_KEYS.STUDENT, id], updated);
      void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.STUDENTS });
      form.reset(toFormValues(updated));
      setIsEditing(false);
    },
    onError: (error) => {
      applyFieldErrors(error, form.setError, FORM_FIELDS);
      // Bring the offending field into view; on a long form the message can
      // otherwise land above the fold.
      requestAnimationFrame(() => {
        document
          .querySelector('[aria-invalid="true"], [role="alert"]')
          ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      });
    },
  });

  // Framed like the page it stands in for, so the scrollport does not appear only once data lands.
  if (student.isPending) {
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
          content: TAB_CONTENT[value]({ form, detail }),
        })),
      }}
      footer={
        isEditing ? (
          <>
            {save.error ? (
              <Alert variant="danger">Check the highlighted fields above.</Alert>
            ) : null}
            {/* Cancel is neutral grey, never red — it destroys nothing. */}
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                form.reset();
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
            meta={`+91 ${detail.mobile} · ${signInSummary(detail)}`}
            action={
              onDetails && !isEditing ? (
                <Button variant="outline" size="sm" onClick={() => setIsEditing(true)}>
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
              isEditing
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
