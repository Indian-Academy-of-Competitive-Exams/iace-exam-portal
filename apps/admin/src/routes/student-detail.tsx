import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm, useWatch, type UseFormReturn } from 'react-hook-form';
import { FileText, Pencil, Plus, Save, Trash2 } from 'lucide-react';
import {
  EARLIEST_BIRTH_DATE,
  EXAM_FAMILIES,
  examsInFamilies,
  STUDENT_TYPE,
  STUDENT_TYPES,
  todayISO,
  type ExamFamily,
  type Gender,
  type StudentDetail,
  type UpdateStudentBody,
  type StudentGrantRow,
  type StudentType,
} from '@iace/contracts';
import {
  Alert,
  Avatar,
  Badge,
  Button,
  Card,
  Combobox,
  ConfirmDialog,
  DatePicker,
  Field,
  FormPanel,
  FormSection,
  Input,
  MultiCombobox,
  PageHeader,
  Skeleton,
  SkeletonParagraph,
} from '@iace/ui';
import { TestSeriesPicker } from '../components/access-picker';
import { api } from '../lib/api';
import { WHEN_FORMATTER } from '../lib/audit-format';
import { familyLabel, NAV_ITEMS, STUDENT_TYPE_LABELS } from '../lib/constants';
import { useBranchChoice, useBranches } from '../lib/use-branches';
import { useExams } from '../lib/use-exams';
import { useAuth } from '../providers/auth';
import { applyFieldErrors } from '@iace/app-kit';
import { PageCrumbs } from '@iace/app-kit/browser';

interface FormValues {
  fullName: string;
  studentType: StudentType;
  enrolledExams: string[];
  enrolledFamilies: ExamFamily[];
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
  'enrolledFamilies',
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
    enrolledFamilies: [...student.enrolledFamilies],
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

/** The three sign-in states, listed. Mirrors SignInStatus on the roster. */
function SignInBadge({ detail }: Readonly<{ detail: StudentDetail }>) {
  if (detail.hasSignedIn) return <Badge variant="success">Has signed in</Badge>;
  if (detail.hasDefaultPin) return <Badge variant="warning">Default PIN — not yet changed</Badge>;
  return <Badge variant="info">Never signed in</Badge>;
}

/** Where a student sits relative to the institute — the four fields access resolves through. */
function AccessCard({ form }: Readonly<{ form: UseFormReturn<FormValues> }>) {
  const exams = useExams({ activeOnly: true });
  // Unfiltered: a student's current branch can be one that has since been retired, and
  // it must still resolve to a name rather than the raw id the active list no longer carries.
  const allBranches = useBranches();
  const enrolledExams = useWatch({ control: form.control, name: 'enrolledExams' }) ?? [];
  const enrolledFamilies = useWatch({ control: form.control, name: 'enrolledFamilies' }) ?? [];
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
          htmlFor="enrolledFamilies"
          label="Enrolled families"
          error={form.formState.errors.enrolledFamilies?.message}
        >
          {({ id, 'aria-describedby': describedBy, 'aria-invalid': invalid }) => (
            <MultiCombobox
              id={id}
              aria-describedby={describedBy}
              aria-invalid={invalid}
              value={enrolledFamilies}
              onChange={(next) =>
                form.setValue('enrolledFamilies', next as ExamFamily[], { shouldDirty: true })
              }
              items={EXAM_FAMILIES.map((family) => ({
                value: family,
                label: familyLabel(family),
              }))}
              placeholder="No families yet"
              emptyLabel="No family matches that"
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
              items={examsInFamilies(exams, enrolledFamilies, enrolledExams).map((exam) => ({
                value: exam.code,
                label: exam.code,
                hint: exam.name,
              }))}
              placeholder="No exams yet"
              emptyLabel="No exam matches that"
            />
          )}
        </Field>

        <Field
          htmlFor="currentBranchId"
          label="Current branch"
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

const grantsKey = (studentId: string) => ['admin', 'student', studentId, 'grants'] as const;

/**
 * The escape hatch: one series, one student, because nothing else reaches them. An enrolment or a
 * program is how access normally arrives — a grant is what is left when neither fits.
 */
function GrantsCard({ detail }: Readonly<{ detail: StudentDetail }>) {
  const queryClient = useQueryClient();
  const [chosen, setChosen] = useState({ id: '', name: '' });
  const [granting, setGranting] = useState(false);
  const [revoking, setRevoking] = useState<StudentGrantRow | null>(null);
  const studentId = detail.id;
  const name = detail.fullName ?? detail.mobile;

  const grants = useQuery({
    queryKey: grantsKey(studentId),
    queryFn: () => api.admin.grants.list(studentId),
  });

  const grant = useMutation({
    meta: { success: 'Series granted.' },
    mutationFn: () => api.admin.grants.create(studentId, { testSeriesId: chosen.id }),
    onSuccess: (rows) => {
      setGranting(false);
      setChosen({ id: '', name: '' });
      queryClient.setQueryData(grantsKey(studentId), rows);
    },
    // Drop out of the confirm on failure, or the card is left asking a question
    // that has already been answered.
    onError: () => setGranting(false),
  });

  const revoke = useMutation({
    meta: { success: 'Grant revoked.' },
    mutationFn: (testSeriesId: string) => api.admin.grants.remove(studentId, testSeriesId),
    onSuccess: () => {
      setRevoking(null);
      void queryClient.invalidateQueries({ queryKey: grantsKey(studentId) });
    },
    onError: () => setRevoking(null),
  });

  return (
    <FormSection title="Series granted directly">
      <div className="flex flex-col gap-4">
        <GrantList
          grants={grants.data ?? []}
          isLoading={grants.isLoading}
          busy={revoke.isPending}
          onRevoke={setRevoking}
        />

        {/* Not a nested <form>: this card stands inside the profile form. */}
        <div className="flex flex-wrap items-end gap-3">
          <Field
            htmlFor="grantSeries"
            label="Grant another series"
            hint={
              detail.isTestBlocked
                ? 'Blocked from tests — lift the block before granting a series.'
                : 'Search the whole catalog. Granting one they already have changes nothing.'
            }
            className="min-w-56 flex-1"
          >
            {({ id, 'aria-describedby': describedBy }) => (
              <TestSeriesPicker
                id={id}
                aria-describedby={describedBy}
                value={chosen.id}
                selectedLabel={chosen.name || undefined}
                clearable
                placeholder="Choose a series"
                onChange={(value, label) => setChosen({ id: value, name: label })}
              />
            )}
          </Field>

          <Button
            type="button"
            variant="outline"
            disabled={chosen.id === '' || detail.isTestBlocked}
            loading={grant.isPending}
            onClick={() => setGranting(true)}
          >
            <Plus aria-hidden />
            Grant
          </Button>
        </div>
      </div>

      {/* A grant is the one direct student-to-offering link in the model, so it is
          stated in full before it is written. */}
      <ConfirmDialog
        open={granting}
        onOpenChange={(open) => !open && setGranting(false)}
        loading={grant.isPending}
        title={`Grant ${chosen.name} to ${name}?`}
        description={`They reach every test in ${chosen.name} from now on, whatever their enrolments and programs say, for as long as the series is switched on at their branch. It is one row for this one student and changes nothing for anybody else.`}
        confirmLabel="Grant series"
        onConfirm={() => grant.mutate()}
      />

      <ConfirmDialog
        open={revoking !== null}
        onOpenChange={(open) => !open && setRevoking(null)}
        destructive
        loading={revoke.isPending}
        title={`Revoke ${revoking?.testSeries.name} from ${name}?`}
        description={`They lose this route to its tests straight away. If an enrolment or a program also reaches ${revoking?.testSeries.name}, they keep it through that. Attempts already made and their results are kept.`}
        confirmLabel="Revoke grant"
        onConfirm={() => revoking && revoke.mutate(revoking.testSeriesId)}
      />
    </FormSection>
  );
}

/** The three states of the grant list, so the card above stays one shape. */
function GrantList({
  grants,
  isLoading,
  busy,
  onRevoke,
}: Readonly<{
  grants: readonly StudentGrantRow[];
  isLoading: boolean;
  busy: boolean;
  onRevoke: (grant: StudentGrantRow) => void;
}>) {
  if (isLoading) return <SkeletonParagraph lines={2} />;

  if (grants.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No series has been granted to this student. Everything they reach comes from their
        enrolments and programs.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {grants.map((grant) => (
        <li
          key={grant.testSeriesId}
          className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2"
        >
          <span className="flex flex-col">
            <span className="text-sm font-medium text-foreground">{grant.testSeries.name}</span>
            <span className="text-xs text-muted-foreground">
              Granted {WHEN_FORMATTER.format(new Date(grant.createdAt))}
            </span>
          </span>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => onRevoke(grant)}
          >
            <Trash2 aria-hidden />
            Revoke
          </Button>
        </li>
      ))}
    </ul>
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
  const [isEditing, setIsEditing] = useState(false);

  const student = useQuery({
    queryKey: ['admin', 'student', id],
    queryFn: () => api.admin.students.detail(id),
  });

  const form = useForm<FormValues>({
    defaultValues: {
      fullName: '',
      studentType: STUDENT_TYPE.ONLINE,
      enrolledExams: [],
      enrolledFamilies: [],
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
  const gender = useWatch({ control: form.control, name: 'gender' }) ?? '';
  const dob = useWatch({ control: form.control, name: 'dob' }) ?? '';

  // Seeded on load and only when the id changes, or a refetch wipes an in-progress edit.
  useEffect(() => {
    if (student.data) form.reset(toFormValues(student.data));
  }, [student.data?.id]);

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
        ...(form.formState.dirtyFields.enrolledFamilies
          ? { enrolledFamilies: values.enrolledFamilies }
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
      queryClient.setQueryData(['admin', 'student', id], updated);
      void queryClient.invalidateQueries({ queryKey: ['admin', 'students'] });
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
    <FormPanel
      disabled={!isEditing}
      onSubmit={form.handleSubmit((values) => save.mutate(values))}
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
        <PageHeader
          breadcrumbs={
            <PageCrumbs nav={NAV_ITEMS} tail={[{ label: detail.fullName ?? detail.mobile }]} />
          }
          title={detail.fullName ?? detail.mobile}
          meta={`+91 ${detail.mobile}`}
          action={
            <div className="flex flex-wrap items-center gap-2">
              {/* Outside the fieldset, so suspending a sign-in never waits on Edit. */}
              <StudentStateSwitches detail={detail} />
              {!isEditing ? (
                <Button variant="outline" size="sm" onClick={() => setIsEditing(true)}>
                  <Pencil aria-hidden />
                  Edit details
                </Button>
              ) : null}
            </div>
          }
        />
      }
    >
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

      <FormSection title="Uploads">
        <div className="flex flex-wrap gap-2">
          <DocumentLink label="Passport photo" url={detail.profile?.photoUrl} />
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
                    clearable={false}
                    value={gender}
                    onChange={(next) =>
                      form.setValue('gender', next as FormValues['gender'], { shouldDirty: true })
                    }
                    items={[
                      { value: '', label: 'Not recorded' },
                      { value: 'MALE', label: 'Male' },
                      { value: 'FEMALE', label: 'Female' },
                      { value: 'OTHER', label: 'Other' },
                    ]}
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

        <div className="flex flex-col gap-8">
          <AccessCard form={form} />
          <GrantsCard detail={detail} />
        </div>
      </div>
    </FormPanel>
  );
}
