import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm, useWatch, type UseFormRegisterReturn, type UseFormReturn } from 'react-hook-form';
import { ArrowLeft, FileText, Save } from 'lucide-react';
import {
  AUDIT_FEATURE,
  PROGRAM_MAX,
  STUDENT_TYPE,
  STUDENT_TYPES,
  todayISO,
  type Gender,
  type GroupRef,
  type StudentDetail,
  type StudentType,
} from '@iace/contracts';
import {
  Alert,
  Avatar,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Combobox,
  ConfirmDialog,
  Field,
  Input,
  MultiCombobox,
  PageHeader,
  Select,
  Skeleton,
  SkeletonParagraph,
} from '@iace/ui';
import { EntityHistory } from '../components/entity-history';
import { GroupPicker } from '../components/group-picker';
import { api } from '../lib/api';
import { ROUTES, STUDENT_TYPE_LABELS } from '../lib/constants';
import { useBranches } from '../lib/use-branches';
import { useExamTypes } from '../lib/use-exam-types';
import { useAuth } from '../providers/auth';
import { applyFieldErrors } from '@iace/app-kit';

interface FormValues {
  fullName: string;
  studentType: StudentType;
  enrolledExams: string[];
  program: string;
  currentBranchId: string;
  motherName: string;
  fatherName: string;
  dob: string;
  email: string;
  address: string;
  gender: '' | Gender;
  groupIds: string[];
}

const FORM_FIELDS = [
  'fullName',
  'studentType',
  'enrolledExams',
  'program',
  'currentBranchId',
  'motherName',
  'fatherName',
  'dob',
  'email',
  'address',
  'gender',
  'groupIds',
] as const;

/** An empty input means "no value", which the API expresses as null. */
const orNull = (value: string) => (value.trim() === '' ? null : value.trim());

function toFormValues(student: StudentDetail): FormValues {
  return {
    fullName: student.fullName ?? '',
    studentType: student.studentType,
    enrolledExams: [...student.enrolledExams],
    program: student.program ?? '',
    currentBranchId: student.currentBranchId ?? '',
    motherName: student.profile?.motherName ?? '',
    fatherName: student.profile?.fatherName ?? '',
    dob: student.profile?.dob ?? '',
    email: student.profile?.email ?? '',
    address: student.profile?.address ?? '',
    gender: student.profile?.gender ?? '',
    groupIds: student.groups.map((group) => group.id),
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

/** The three sign-in states, listed. Mirrors SignInStatus on the roster. */
function SignInBadge({ detail }: Readonly<{ detail: StudentDetail }>) {
  if (detail.hasSignedIn) return <Badge variant="success">Has signed in</Badge>;
  if (detail.hasDefaultPin) return <Badge variant="warning">Default PIN — not yet changed</Badge>;
  return <Badge variant="info">Never signed in</Badge>;
}

/** Where a student sits relative to the institute — the four fields access resolves through. */
function AccessCard({ form }: Readonly<{ form: UseFormReturn<FormValues> }>) {
  const examTypes = useExamTypes({ activeOnly: true });
  const branches = useBranches({ activeOnly: true });
  // Unfiltered: a student's current branch can be one that has since been retired, and
  // it must still resolve to a name rather than the raw id `branches` no longer carries.
  const allBranches = useBranches();
  const enrolledExams = useWatch({ control: form.control, name: 'enrolledExams' }) ?? [];
  const currentBranchId = useWatch({ control: form.control, name: 'currentBranchId' }) ?? '';
  const currentBranchName = allBranches.find((branch) => branch.id === currentBranchId)?.name;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Access</CardTitle>
        <CardDescription>
          Enrolments are how a student reaches an exam or programme group — no membership is added
          for them. Scholarship and non-IACE groups are granted below instead.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Field
          htmlFor="studentType"
          label="Student type"
          error={form.formState.errors.studentType?.message}
        >
          {(control) => (
            <Select {...control} {...form.register('studentType')}>
              {STUDENT_TYPES.map((value) => (
                <option key={value} value={value}>
                  {STUDENT_TYPE_LABELS[value]}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <Field
          htmlFor="enrolledExams"
          label="Enrolled exams"
          hint="Every exam or programme group under these is reachable."
          error={form.formState.errors.enrolledExams?.message}
        >
          {({ id, 'aria-describedby': describedBy, 'aria-invalid': invalid }) => (
            <MultiCombobox
              id={id}
              aria-describedby={describedBy}
              aria-invalid={invalid}
              value={enrolledExams}
              onChange={(next) => form.setValue('enrolledExams', next, { shouldDirty: true })}
              items={examTypes.map((examType) => ({
                value: examType.code,
                label: examType.code,
                hint: examType.name,
              }))}
              placeholder="No exams yet"
              emptyLabel="No exam type matches that"
            />
          )}
        </Field>

        <Field htmlFor="program" label="Programme" error={form.formState.errors.program?.message}>
          {(control) => (
            <Input {...control} maxLength={PROGRAM_MAX} {...form.register('program')} />
          )}
        </Field>

        <Field
          htmlFor="currentBranchId"
          label="Current branch"
          hint="The centre they attend now — what scheduling reads."
          error={form.formState.errors.currentBranchId?.message}
        >
          {({ id, 'aria-describedby': describedBy, 'aria-invalid': invalid }) => (
            <Combobox
              id={id}
              aria-describedby={describedBy}
              aria-invalid={invalid}
              value={currentBranchId}
              selectedLabel={currentBranchName}
              onChange={(next) => form.setValue('currentBranchId', next, { shouldDirty: true })}
              items={branches.map((branch) => ({ value: branch.id, label: branch.name }))}
              placeholder="Not recorded"
              emptyLabel="No branch matches that"
            />
          )}
        </Field>
      </CardContent>
    </Card>
  );
}

/** A blocked student may lose a grant but not gain one, so the unticked boxes lock. */
function GroupsCard({
  isTestBlocked,
  known,
  selectedIds,
  register,
  error,
}: Readonly<{
  isTestBlocked: boolean;
  known: GroupRef[];
  selectedIds: string[];
  register: UseFormRegisterReturn;
  error?: string;
}>) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Group grants</CardTitle>
        <CardDescription>
          Scholarship and non-IACE groups, given student by student. Exam and programme groups are
          not here — they follow the enrolments above.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {isTestBlocked ? (
          <Alert variant="info">
            <span>
              Blocked from tests, so no new group can be granted. Their current grants can still be
              taken away, or lift the block first.
            </span>
          </Alert>
        ) : null}

        <GroupPicker
          idPrefix="group"
          register={register}
          selectedIds={selectedIds}
          known={known}
          error={error}
          lockedToSelection={isTestBlocked}
        />
      </CardContent>
    </Card>
  );
}

/** The two switches that decide what a student may do: sit tests, and sign in at all. */
function StudentStateSwitches({ detail }: Readonly<{ detail: StudentDetail }>) {
  const queryClient = useQueryClient();
  const [blockConfirm, setBlockConfirm] = useState(false);
  const [signInConfirm, setSignInConfirm] = useState(false);
  const isSuperAdmin = useAuth().identity?.isSuperAdmin ?? false;
  const { id, isActive, isTestBlocked } = detail;
  const name = detail.fullName ?? detail.mobile;

  const applyUpdate = (updated: StudentDetail) => {
    queryClient.setQueryData(['admin', 'student', id], updated);
    void queryClient.invalidateQueries({ queryKey: ['admin', 'students'] });
  };

  const setTestBlocked = useMutation({
    meta: {
      success: (): string => (isTestBlocked ? 'Tests allowed again.' : 'Blocked from tests.'),
    },
    mutationFn: (next: boolean) => api.admin.students.setTestBlocked(id, { isTestBlocked: next }),
    onError: () => setBlockConfirm(false),
    onSuccess: (updated) => {
      setBlockConfirm(false);
      applyUpdate(updated);
    },
  });

  const setActive = useMutation({
    meta: {
      success: (): string => (isActive ? 'Sign-in suspended.' : 'Sign-in restored.'),
    },
    mutationFn: (next: boolean) => api.admin.students.setActive(id, next),
    onError: () => setSignInConfirm(false),
    onSuccess: (updated) => {
      setSignInConfirm(false);
      applyUpdate(updated);
    },
  });

  return (
    <div className="flex flex-wrap gap-2">
      <Button
        variant={isTestBlocked ? 'secondary' : 'destructive'}
        size="sm"
        loading={setTestBlocked.isPending}
        onClick={() => setBlockConfirm(true)}
      >
        {isTestBlocked ? 'Allow tests' : 'Block from tests'}
      </Button>
      {isSuperAdmin ? (
        <Button
          variant="outline"
          size="sm"
          loading={setActive.isPending}
          onClick={() => setSignInConfirm(true)}
        >
          {isActive ? 'Suspend sign-in' : 'Restore sign-in'}
        </Button>
      ) : null}

      {/* Both directions ask, so a control that changes whether somebody can sit
          an exam never acts on a single click. */}
      <ConfirmDialog
        open={blockConfirm}
        onOpenChange={setBlockConfirm}
        destructive={!isTestBlocked}
        loading={setTestBlocked.isPending}
        title={isTestBlocked ? `Allow ${name} to sit tests again?` : `Block ${name} from tests?`}
        description={
          isTestBlocked
            ? 'They can start tests again straight away, on everything their enrolments and grants reach. Nothing was lost while it was on.'
            : 'They can still sign in and see every test they have already sat, and their results. They cannot start a new one until this is lifted. A session they already have open is not signed out.'
        }
        confirmLabel={isTestBlocked ? 'Allow tests' : 'Block from tests'}
        onConfirm={() => setTestBlocked.mutate(!isTestBlocked)}
      />

      <ConfirmDialog
        open={signInConfirm}
        onOpenChange={setSignInConfirm}
        destructive={isActive}
        loading={setActive.isPending}
        title={isActive ? `Suspend sign-in for ${name}?` : `Restore sign-in for ${name}?`}
        description={
          isActive
            ? 'They cannot sign in at all, on any device. A session they already have open is not revoked — it lasts until its token expires. Their record, attempts and results are kept.'
            : 'They can sign in again. Whether they may sit a test is the other switch, and this does not change it.'
        }
        confirmLabel={isActive ? 'Suspend sign-in' : 'Restore sign-in'}
        onConfirm={() => setActive.mutate(!isActive)}
      />
    </div>
  );
}

export function StudentDetailPage() {
  const { id = '' } = useParams();
  const queryClient = useQueryClient();
  const [saved, setSaved] = useState(false);

  const student = useQuery({
    queryKey: ['admin', 'student', id],
    queryFn: () => api.admin.students.detail(id),
  });

  const form = useForm<FormValues>({
    defaultValues: {
      fullName: '',
      studentType: STUDENT_TYPE.ONLINE,
      enrolledExams: [],
      program: '',
      currentBranchId: '',
      motherName: '',
      fatherName: '',
      dob: '',
      email: '',
      address: '',
      gender: '',
      groupIds: [],
    },
  });

  // useWatch, not form.watch: a fresh function each render re-renders the picker on every keystroke.
  const selectedGroupIds = useWatch({ control: form.control, name: 'groupIds' }) ?? [];

  // Seeded on load and only when the id changes, or a refetch wipes an in-progress edit.
  useEffect(() => {
    if (student.data) form.reset(toFormValues(student.data));
  }, [student.data?.id]);

  const save = useMutation({
    meta: { success: 'Saved.', fields: FORM_FIELDS },
    mutationFn: (values: FormValues) =>
      api.admin.students.update(id, {
        fullName: orNull(values.fullName),
        studentType: values.studentType,
        program: orNull(values.program),
        currentBranchId: orNull(values.currentBranchId),
        // An omitted key means "leave it alone", which is true of a list nobody touched.
        ...(form.formState.dirtyFields.enrolledExams
          ? { enrolledExams: values.enrolledExams }
          : {}),
        ...(form.formState.dirtyFields.groupIds ? { groupIds: values.groupIds } : {}),
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
      queryClient.setQueryData(['admin', 'student', id], updated);
      void queryClient.invalidateQueries({ queryKey: ['admin', 'students'] });
      form.reset(toFormValues(updated));
      setSaved(true);
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

  // Shaped like the page it stands in for: a heading, then the two cards.
  if (student.isPending) {
    return (
      <div className="flex flex-col gap-5">
        <Skeleton variant="title" />
        <Card className="p-6">
          <SkeletonParagraph lines={3} />
        </Card>
        <Card className="p-6">
          <SkeletonParagraph lines={5} />
        </Card>
      </div>
    );
  }
  if (student.error || !student.data) {
    // The reason is on the toast; this only has to stop the page being blank.
    return <Alert variant="danger">Could not load this student.</Alert>;
  }

  const detail = student.data;

  return (
    <>
      <Button variant="ghost" size="sm" className="mb-3 -ml-2" asChild>
        <Link to={ROUTES.STUDENTS}>
          <ArrowLeft aria-hidden />
          All students
        </Link>
      </Button>

      <PageHeader
        title={detail.fullName ?? detail.mobile}
        description={`+91 ${detail.mobile}`}
        action={<StudentStateSwitches detail={detail} />}
      />

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <Avatar
          src={detail.profile?.photoUrl}
          name={detail.fullName}
          fallback={detail.mobile}
          size="md"
        />
        {!detail.isActive ? <Badge variant="danger">Sign-in suspended</Badge> : null}
        {detail.isTestBlocked ? <Badge variant="danger">Blocked from tests</Badge> : null}
        <SignInBadge detail={detail} />
        <Badge variant={detail.preTestReady ? 'success' : 'neutral'}>
          Pre-test details {detail.preTestReady ? 'on file' : 'needed'}
        </Badge>
        <Badge variant={detail.profileCompleted ? 'success' : 'neutral'}>
          Full profile {detail.profileCompleted ? 'complete' : 'incomplete'}
        </Badge>
      </div>

      <Card className="mb-5">
        <CardHeader>
          <CardTitle>Documents the student has uploaded</CardTitle>
          <CardDescription>
            Read-only here — only the student can replace them. Links expire after a few minutes.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <DocumentLink label="Passport photo" url={detail.profile?.photoUrl} />
          <DocumentLink label="Aadhaar" url={detail.profile?.aadhaarUrl} />
          <DocumentLink label="PAN" url={detail.profile?.panUrl} />
        </CardContent>
      </Card>

      <EntityHistory feature={AUDIT_FEATURE.STUDENT} entityId={detail.id} className="mb-5" />

      <form
        className="grid gap-5 lg:grid-cols-2"
        onSubmit={form.handleSubmit((values) => {
          setSaved(false);
          save.mutate(values);
        })}
        noValidate
      >
        <Card>
          <CardHeader>
            <CardTitle>Details</CardTitle>
            <CardDescription>
              Mother&apos;s name, father&apos;s name and date of birth are the three the student is
              asked for before a test.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
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
                {/* The browser's own picker refuses a future date too, so the
                    rule is visible before it is enforced. */}
                {(control) => (
                  <Input {...control} type="date" max={todayISO()} {...form.register('dob')} />
                )}
              </Field>
              <Field htmlFor="gender" label="Gender" error={form.formState.errors.gender?.message}>
                {(control) => (
                  <Select {...control} {...form.register('gender')}>
                    <option value="">Not recorded</option>
                    <option value="MALE">Male</option>
                    <option value="FEMALE">Female</option>
                    <option value="OTHER">Other</option>
                  </Select>
                )}
              </Field>
            </div>

            <Field htmlFor="email" label="Email" error={form.formState.errors.email?.message}>
              {(control) => <Input {...control} type="email" {...form.register('email')} />}
            </Field>

            <Field htmlFor="address" label="Address" error={form.formState.errors.address?.message}>
              {(control) => <Input {...control} {...form.register('address')} />}
            </Field>
          </CardContent>
        </Card>

        <div className="flex flex-col gap-5">
          <AccessCard form={form} />

          <GroupsCard
            isTestBlocked={detail.isTestBlocked}
            known={detail.groups}
            selectedIds={selectedGroupIds}
            register={form.register('groupIds')}
            error={form.formState.errors.groupIds?.message}
          />

          <Card>
            <CardContent className="flex flex-col gap-3 pt-6">
              {save.error ? (
                // Says something beside the button: the offending field may be a card away.
                <Alert variant="danger">Check the highlighted fields above.</Alert>
              ) : null}
              {saved && !form.formState.isDirty ? <Alert variant="success">Saved.</Alert> : null}

              <Button
                type="submit"
                icon={<Save aria-hidden />}
                loading={save.isPending}
                disabled={!form.formState.isDirty}
              >
                Save changes
              </Button>
            </CardContent>
          </Card>
        </div>
      </form>
    </>
  );
}
