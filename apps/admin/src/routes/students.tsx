import { useMemo } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Upload, UserPlus } from 'lucide-react';
import {
  BRANCH_TYPE,
  EXAM_FAMILIES,
  examsInFamilies,
  FEATURE_KEYS,
  MOBILE_DIGITS,
  PERMISSION_LEVELS,
  STUDENT_SORTS,
  STUDENT_TYPE,
  STUDENT_TYPES,
  todayISO,
  createStudentSchema,
  normaliseMobile,
  type CreateStudentInput,
  type ExamFamily,
  type StudentSort,
  type StudentSummary,
  type StudentType,
} from '@iace/contracts';
import {
  Badge,
  BadgeList,
  Button,
  Combobox,
  FormDialog,
  FormField,
  Input,
  ListView,
  MultiCombobox,
  NumericInput,
  PageHeader,
  TableFrame,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TruncatedText,
  cn,
  digitsOnly,
  linkVariants,
  type DataTableColumn,
  useTruncation,
} from '@iace/ui';
import { api } from '../lib/api';
import { familyLabel, NAV_ITEMS, ROUTES, STUDENT_TYPE_LABELS } from '../lib/constants';
import { applyFieldErrors } from '@iace/app-kit';
import { PageCrumbs, useListScreen } from '@iace/app-kit/browser';
import { useBranchChoice, useBranches } from '../lib/use-branches';
import { useExams } from '../lib/use-exams';
import { useAuth } from '../providers/auth';
type StatusFilter = 'all' | 'active' | 'inactive' | 'blocked' | 'invited' | 'defaultpin';

/** `false` is a question ("not ready yet"), not "don't care" — absent is "don't care". */
function asBooleanParam(value: string): 'true' | 'false' | undefined {
  return value === 'true' || value === 'false' ? value : undefined;
}

/** Each filter is one query shape; keeping them together stops them contradicting. */
const STATUS_QUERY: Record<
  StatusFilter,
  {
    isActive?: 'true' | 'false';
    isTestBlocked?: 'true';
    neverSignedIn?: 'true';
    hasDefaultPin?: 'true';
  }
> = {
  all: {},
  active: { isActive: 'true' },
  inactive: { isActive: 'false' },
  blocked: { isTestBlocked: 'true' },
  invited: { neverSignedIn: 'true' },
  defaultpin: { hasDefaultPin: 'true' },
};

/** Nothing of their own to reach a series by. An explicit grant is a row this list cannot see. */
const hasNoOwnAccess = (student: StudentSummary): boolean => student.enrolledExams.length === 0;

/** Built outside the component: `cell` is a render prop, not a component declaration. */
function studentColumns(): DataTableColumn<StudentSummary>[] {
  return [
    { key: 'name', header: 'Student', cell: (s) => <StudentNameCell student={s} /> },
    {
      key: 'mobile',
      header: 'Mobile',
      className: 'tabular-nums text-muted-foreground',
      cell: (s) => s.mobile,
    },
    {
      key: 'access',
      header: 'Access',
      cell: (s) =>
        hasNoOwnAccess(s) ? (
          // Neither enrolled nor granted — not the same as "no access": GLOBAL
          // reaches everyone, and this query cannot see that.
          <Badge variant="warning">No enrolment or grant</Badge>
        ) : (
          <AccessCell student={s} />
        ),
    },
    {
      key: 'status',
      header: 'Status',
      cell: (s) => (
        <div className="flex flex-wrap items-center gap-1">
          <SignInStatus student={s} />
          {/* Its own badge: being unable to start a test is not a sign-in state. */}
          {s.isTestBlocked ? <Badge variant="danger">Blocked from tests</Badge> : null}
        </div>
      ),
    },
    {
      key: 'pretest',
      header: 'Pre-test details',
      cell: (s) => (
        <Badge variant={s.preTestReady ? 'success' : 'neutral'}>
          {s.preTestReady ? 'On file' : 'Needed'}
        </Badge>
      ),
    },
  ];
}

/**
 * What a student reaches tests through: their exam enrolments, the first shown and the rest
 * behind a count.
 */
function AccessCell({ student }: Readonly<{ student: StudentSummary }>) {
  const labels = [...new Set(student.enrolledExams)];

  return (
    <BadgeList items={labels} label={(entry) => entry} className="max-w-[12rem]">
      {(entry) => (
        <Badge className="min-w-0 shrink">
          <TruncatedText>{entry}</TruncatedText>
        </Badge>
      )}
    </BadgeList>
  );
}

export function StudentsPage() {
  const { can } = useAuth();
  const canWrite = can(FEATURE_KEYS.STUDENT_MANAGEMENT, PERMISSION_LEVELS.WRITE);

  const [searchParams, setSearchParams] = useSearchParams();
  // The "Add student" button links here; reading it is what makes it work.
  const creating = searchParams.get('new') === '1';

  const branches = useBranches();

  // The spec declares the URL keys, so the controls, Clear and the query cannot disagree.
  const filterSpec = [
    {
      key: 'q',
      kind: 'search',
      label: 'Search students',
      placeholder: 'Search by name or mobile',
      primary: true,
    },
    {
      key: 'status',
      kind: 'choice',
      label: 'Filter by status',
      primary: true,
      items: [
        { value: 'all', label: 'All students' },
        { value: 'active', label: 'Active' },
        { value: 'inactive', label: 'Sign-in suspended' },
        { value: 'blocked', label: 'Blocked from tests' },
        { value: 'invited', label: 'Never signed in' },
        { value: 'defaultpin', label: 'Still on the default PIN' },
      ],
    },
    {
      key: 'sort',
      kind: 'choice',
      label: 'Sort by',
      primary: true,
      items: [
        { value: STUDENT_SORTS.RECENT, label: 'Newest first' },
        { value: STUDENT_SORTS.OLDEST, label: 'Oldest first' },
        { value: STUDENT_SORTS.NAME, label: 'Name (A–Z)' },
        { value: STUDENT_SORTS.MOBILE, label: 'Mobile number' },
      ],
    },
    {
      key: 'branchId',
      kind: 'choice',
      label: 'Branch',
      items: [
        { value: '', label: 'Any branch' },
        ...branches.map((option) => ({ value: option.id, label: option.name })),
      ],
    },
    {
      key: 'preTestReady',
      kind: 'choice',
      label: 'Pre-test details',
      items: [
        { value: '', label: 'Any' },
        { value: 'true', label: 'On file' },
        { value: 'false', label: 'Needed' },
      ],
    },
    {
      key: 'profileCompleted',
      kind: 'choice',
      label: 'Full profile',
      items: [
        { value: '', label: 'Any' },
        { value: 'true', label: 'Complete' },
        { value: 'false', label: 'Incomplete' },
      ],
    },
    {
      key: 'noAccess',
      kind: 'choice',
      label: 'Access',
      items: [
        { value: '', label: 'Any' },
        { value: 'true', label: 'Nothing of their own' },
        { value: 'false', label: 'Has an enrolment or program' },
      ],
    },
    { key: 'joinedFrom', kind: 'date', label: 'Enrolled from', max: todayISO() },
    { key: 'joinedTo', kind: 'date', label: 'Enrolled until', max: todayISO() },
  ] as const;

  const students = useListScreen({
    queryKey: ['admin', 'students'],
    filters: filterSpec,
    toQuery: (values) => ({
      q: values.q || undefined,
      branchId: values.branchId || undefined,
      preTestReady: asBooleanParam(values.preTestReady),
      profileCompleted: asBooleanParam(values.profileCompleted),
      noAccess: asBooleanParam(values.noAccess),
      joinedFrom: values.joinedFrom || undefined,
      joinedTo: values.joinedTo || undefined,
      sort: (values.sort || undefined) as StudentSort | undefined,
      ...STATUS_QUERY[(values.status || 'all') as StatusFilter],
    }),
    fetchPage: (params) => api.admin.students.list(params),
  });

  const branch = branches.find((candidate) => candidate.id === students.values.branchId);
  const columns = useMemo(() => studentColumns(), []);

  const header = (
    <PageHeader
      breadcrumbs={<PageCrumbs nav={NAV_ITEMS} />}
      title="Students"
      action={
        <div className="flex flex-wrap gap-2">
          {/* Write actions appear only with WRITE. Hiding is not the security
                — the endpoints enforce it — it is not offering a control that
                would be refused. */}
          {canWrite ? (
            <>
              <Button variant="outline" size="sm" asChild>
                <Link to={ROUTES.IMPORT_STUDENTS}>
                  <Upload aria-hidden />
                  Import
                </Link>
              </Button>
              <Button size="sm" asChild>
                <Link to={`${ROUTES.STUDENTS}?new=1`}>
                  <UserPlus aria-hidden />
                  Add student
                </Link>
              </Button>
            </>
          ) : null}
        </div>
      }
    />
  );

  const banner = branch ? (
    // Arrived from a branch link: say so above the fold. Clearing it is the bar's job, once.
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <span className="text-sm text-muted-foreground">Showing</span>
      <Badge variant={branch.type === BRANCH_TYPE.VIRTUAL ? 'info' : 'primary'}>
        {branch.name}
      </Badge>
    </div>
  ) : null;

  return (
    <TableFrame header={header}>
      {/* Rendered inside the frame, not the header: a dialog is portalled, so where it
          sits in the tree costs the pinned header nothing. */}
      <NewStudentDialog
        open={creating}
        onClose={() => {
          searchParams.delete('new');
          setSearchParams(searchParams);
        }}
      />
      <ListView
        list={students}
        filters={filterSpec}
        banner={banner}
        columns={columns}
        rowKey={(student) => student.id}
        empty="No students yet. Add one, or import a roster."
        emptyFiltered="No students match those filters."
      />
    </TableFrame>
  );
}

/** Four sign-in states, in the order they matter. A list, not a chain of ternaries. */
function SignInStatus({ student }: Readonly<{ student: StudentSummary }>) {
  if (!student.isActive) return <Badge variant="danger">Sign-in suspended</Badge>;
  if (student.hasSignedIn) return <Badge variant="success">Active</Badge>;
  // Its own state on purpose: they CAN sign in, but on a PIN anyone holding the
  // roster can work out. "Never signed in" would hide that.
  if (student.hasDefaultPin) return <Badge variant="warning">Default PIN</Badge>;
  return <Badge variant="info">Never signed in</Badge>;
}

/**
 * The name, capped so one long one cannot widen the column. The tooltip hangs off
 * the link, so hover and keyboard focus reveal it from the same target.
 */
function StudentNameCell({ student }: Readonly<{ student: StudentSummary }>) {
  const name = student.fullName;
  const { ref, truncated } = useTruncation<HTMLAnchorElement>(name);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link
          ref={ref}
          to={ROUTES.STUDENT(student.id)}
          className={cn(linkVariants(), 'block max-w-[15rem] truncate')}
        >
          {name ?? <span className="text-muted-foreground">No name yet</span>}
        </Link>
      </TooltipTrigger>
      {truncated && name ? <TooltipContent>{name}</TooltipContent> : null}
    </Tooltip>
  );
}

// ---------------------------------------------------------------------------

const NEW_STUDENT_FIELDS = [
  'mobile',
  'fullName',
  'studentType',
  'enrolledExams',
  'enrolledFamilies',
  'currentBranchId',
] as const;

/** Adds a student before signup. The mobile is the join key, so the OTP flow upserts onto this row. */
function NewStudentDialog({ open, onClose }: Readonly<{ open: boolean; onClose: () => void }>) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const form = useForm<CreateStudentInput>({
    resolver: zodResolver(createStudentSchema),
    defaultValues: {
      mobile: '',
      fullName: '',
      studentType: STUDENT_TYPE.ONLINE,
      enrolledExams: [],
      enrolledFamilies: [],
      currentBranchId: '',
    },
  });

  const enrolledExams = useWatch({ control: form.control, name: 'enrolledExams' }) ?? [];
  const enrolledFamilies = useWatch({ control: form.control, name: 'enrolledFamilies' }) ?? [];
  const currentBranchId = useWatch({ control: form.control, name: 'currentBranchId' }) ?? '';
  const studentType = useWatch({ control: form.control, name: 'studentType' });
  const exams = useExams({ activeOnly: true });
  const branch = useBranchChoice(studentType);
  // Displayed AND submitted, so a locked picker can never show one branch and save another.
  const chosenBranchId = branch.locked ? (branch.forcedId ?? '') : currentBranchId;

  const create = useMutation({
    meta: {
      success: 'Student added.',
      fields: NEW_STUDENT_FIELDS,
    },
    mutationFn: (values: CreateStudentInput) =>
      api.admin.students.create({
        mobile: values.mobile,
        // An untouched name field is "not known yet", not an empty name.
        fullName: values.fullName?.trim() ? values.fullName.trim() : undefined,
        studentType: values.studentType,
        enrolledExams: values.enrolledExams?.length ? values.enrolledExams : undefined,
        enrolledFamilies: values.enrolledFamilies?.length ? values.enrolledFamilies : undefined,
        // An untouched picker is "not recorded"; '' is not a branch id the server could resolve.
        currentBranchId: chosenBranchId || undefined,
      }),
    onSuccess: (student) => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'students'] });
      void navigate(ROUTES.STUDENT(student.id));
    },
    onError: (error) => applyFieldErrors(error, form.setError, NEW_STUDENT_FIELDS),
  });

  return (
    <FormDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title="Add a student"
      submitLabel="Add student"
      loading={create.isPending}
      form={form}
      onSubmit={(values) => create.mutate(values)}
    >
      <FormField form={form} name="mobile" label="Mobile number">
        {(control) => (
          <NumericInput
            {...control}
            autoFocus
            prefix="+91"
            // Room to paste a +91 prefix; normaliseMobile trims it rather than truncating.
            maxLength={15}
            sanitize={(raw) => normaliseMobile(digitsOnly(raw)).slice(0, MOBILE_DIGITS)}
            placeholder="98765 43210"
            className="tabular-nums"
          />
        )}
      </FormField>

      <FormField form={form} name="fullName" label="Full name">
        {(control) => <Input {...control} />}
      </FormField>

      <FormField form={form} name="studentType" label="Student type">
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
            items={STUDENT_TYPES.map((value) => ({ value, label: STUDENT_TYPE_LABELS[value] }))}
          />
        )}
      </FormField>

      <FormField form={form} name="enrolledFamilies" label="Enrolled families">
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
            placeholder="None yet"
            emptyLabel="No family matches that"
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
            items={examsInFamilies(exams, enrolledFamilies, enrolledExams).map((exam) => ({
              value: exam.code,
              label: exam.code,
              hint: exam.name,
            }))}
            placeholder="None yet"
            emptyLabel="No exam matches that"
          />
        )}
      </FormField>

      <FormField form={form} name="currentBranchId" label="Current branch" hint={branch.hint}>
        {({ id, 'aria-describedby': describedBy, 'aria-invalid': invalid }) => (
          <Combobox
            id={id}
            aria-describedby={describedBy}
            aria-invalid={invalid}
            disabled={branch.locked}
            value={chosenBranchId}
            onChange={(next) => form.setValue('currentBranchId', next, { shouldDirty: true })}
            items={branch.branches.map((option) => ({ value: option.id, label: option.name }))}
            placeholder="Not recorded"
            emptyLabel="No branch matches that"
          />
        )}
      </FormField>
    </FormDialog>
  );
}
