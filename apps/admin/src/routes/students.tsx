import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { ChevronDown, RefreshCw, SlidersHorizontal, Upload, UserPlus, X } from 'lucide-react';
import {
  BRANCH_TYPE,
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
  type StudentSort,
  type StudentSummary,
} from '@iace/contracts';
import {
  Badge,
  BadgeList,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  cn,
  Combobox,
  ConfirmDialog,
  DataTable,
  digitsOnly,
  Field,
  FormField,
  Input,
  linkVariants,
  MultiCombobox,
  NumericInput,
  PageHeader,
  Pagination,
  SearchInput,
  Select,
  TableFrame,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TruncatedText,
  useTruncation,
  type DataTableColumn,
  toast,
} from '@iace/ui';
import { api } from '../lib/api';
import { ROUTES, STUDENT_TYPE_LABELS } from '../lib/constants';
import { applyFieldErrors, useListQuery } from '@iace/app-kit';
import { useBranches } from '../lib/use-branches';
import { useExams } from '../lib/use-exams';
import { useFilters } from '../lib/use-filters';
import { useAuth } from '../providers/auth';
type StatusFilter = 'all' | 'active' | 'inactive' | 'blocked' | 'invited' | 'defaultpin';

/** Every filter this screen owns. Named once so "clear all" cannot miss one. */
const ALL_FILTERS = [
  'q',
  'status',
  'sort',
  'branchId',
  'preTestReady',
  'profileCompleted',
  'noAccess',
  'joinedFrom',
  'joinedTo',
] as const;
type FilterKey = (typeof ALL_FILTERS)[number];

/** The ones behind the "Filters" fold — what the count on the button counts. */
const EXTRA_FILTERS = ALL_FILTERS.filter(
  (key) => !['q', 'status', 'sort'].includes(key),
) as readonly FilterKey[];

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
  const [showAll, setShowAll] = useState(false);

  // Every filter lives in the URL, so a link into this screen — from a branch —
  // and the controls on it are the same state. See useFilters.
  const filters = useFilters<FilterKey>();
  const [searchParams, setSearchParams] = useSearchParams();
  // The "Add student" button links here; reading it is what makes it work.
  const creating = searchParams.get('new') === '1';

  const branchId = filters.get('branchId');
  const status = (filters.get('status') || 'all') as StatusFilter;

  const branches = useBranches();
  const branch = branches.find((candidate) => candidate.id === branchId);

  const extraCount = filters.activeCount(EXTRA_FILTERS);
  const filtersOpen = showAll || extraCount > 0;

  const query = {
    q: filters.get('q') || undefined,
    branchId: branchId || undefined,
    preTestReady: asBooleanParam(filters.get('preTestReady')),
    profileCompleted: asBooleanParam(filters.get('profileCompleted')),
    noAccess: asBooleanParam(filters.get('noAccess')),
    joinedFrom: filters.get('joinedFrom') || undefined,
    joinedTo: filters.get('joinedTo') || undefined,
    sort: (filters.get('sort') || undefined) as StudentSort | undefined,
    ...STATUS_QUERY[status],
  };

  // The page resets itself whenever `query` changes, and the rows hold still
  // while the next one arrives — see useListQuery.
  const students = useListQuery({
    queryKey: ['admin', 'students'],
    filters: query,
    fetchPage: (params) => api.admin.students.list(params),
  });

  const columns = useMemo(() => studentColumns(), []);

  const header = (
    <>
      <PageHeader
        title="Students"
        description="Everyone enrolled, however they got here — self-signup, added by hand, or imported."
        action={
          <div className="flex flex-wrap gap-2">
            <SyncStudentsButton />
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

      {creating ? (
        <NewStudentCard
          onClose={() => {
            searchParams.delete('new');
            setSearchParams(searchParams);
          }}
        />
      ) : null}
    </>
  );

  const toolbar = (
    <>
      {/* Arrived from somewhere: say where, and offer the way back out. */}
      {branch ? (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground">Showing</span>
          {branch ? (
            <Badge variant={branch.type === BRANCH_TYPE.VIRTUAL ? 'info' : 'primary'}>
              {branch.name}
            </Badge>
          ) : null}
          <Button variant="ghost" size="sm" onClick={() => filters.set({ branchId: '' })}>
            <X aria-hidden />
            Clear
          </Button>
        </div>
      ) : null}

      <div className="mb-3 flex flex-wrap gap-3">
        <div className="min-w-56 flex-1">
          <SearchInput
            aria-label="Search students"
            placeholder="Search by name or mobile"
            value={filters.get('q')}
            onChange={(q) => filters.set({ q })}
          />
        </div>

        <div className="w-44">
          <Select
            aria-label="Filter by status"
            value={status}
            onChange={(event) => filters.set({ status: event.target.value })}
          >
            <option value="all">All students</option>
            <option value="active">Active</option>
            <option value="inactive">Sign-in suspended</option>
            <option value="blocked">Blocked from tests</option>
            <option value="invited">Never signed in</option>
            <option value="defaultpin">Still on the default PIN</option>
          </Select>
        </div>

        <div className="w-44">
          <Select
            aria-label="Sort by"
            value={filters.get('sort') || STUDENT_SORTS.RECENT}
            onChange={(event) => filters.set({ sort: event.target.value })}
          >
            <option value={STUDENT_SORTS.RECENT}>Newest first</option>
            <option value={STUDENT_SORTS.OLDEST}>Oldest first</option>
            <option value={STUDENT_SORTS.NAME}>Name (A–Z)</option>
            <option value={STUDENT_SORTS.MOBILE}>Mobile number</option>
          </Select>
        </div>

        {/*
            The rest are folded away by default. Seven controls across the top
            of the roster is a wall to read past every time you only wanted to
            search a name — but the count keeps a hidden filter from being a
            silent one.
          */}
        <Button variant="outline" onClick={() => setShowAll((open) => !open)}>
          <SlidersHorizontal aria-hidden />
          Filters
          {extraCount > 0 ? <Badge variant="primary">{extraCount}</Badge> : null}
          <ChevronDown
            aria-hidden
            className={cn('transition-transform', showAll && 'rotate-180')}
          />
        </Button>
      </div>

      {filtersOpen ? (
        <div className="mb-4 grid gap-3 rounded-lg border border-border bg-muted/40 p-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field htmlFor="filter-branch" label="Branch">
            {(control) => (
              <Select
                {...control}
                value={branchId}
                onChange={(event) => filters.set({ branchId: event.target.value })}
              >
                <option value="">Any branch</option>
                {branches.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field htmlFor="filter-pretest" label="Pre-test details">
            {(control) => (
              <Select
                {...control}
                value={filters.get('preTestReady')}
                onChange={(event) => filters.set({ preTestReady: event.target.value })}
              >
                <option value="">Any</option>
                <option value="true">On file</option>
                <option value="false">Needed</option>
              </Select>
            )}
          </Field>

          <Field htmlFor="filter-profile" label="Full profile">
            {(control) => (
              <Select
                {...control}
                value={filters.get('profileCompleted')}
                onChange={(event) => filters.set({ profileCompleted: event.target.value })}
              >
                <option value="">Any</option>
                <option value="true">Complete</option>
                <option value="false">Incomplete</option>
              </Select>
            )}
          </Field>

          <Field
            htmlFor="filter-no-access"
            label="Access"
            hint="No enrolment and no program of their own — not the same as no access."
          >
            {(control) => (
              <Select
                {...control}
                value={filters.get('noAccess')}
                onChange={(event) => filters.set({ noAccess: event.target.value })}
              >
                <option value="">Any</option>
                <option value="true">Nothing of their own</option>
                <option value="false">Has an enrolment or program</option>
              </Select>
            )}
          </Field>

          <Field htmlFor="filter-from" label="Enrolled from">
            {(control) => (
              <Input
                {...control}
                type="date"
                max={todayISO()}
                value={filters.get('joinedFrom')}
                onChange={(event) => filters.set({ joinedFrom: event.target.value })}
              />
            )}
          </Field>

          <Field htmlFor="filter-to" label="Enrolled until">
            {(control) => (
              <Input
                {...control}
                type="date"
                max={todayISO()}
                value={filters.get('joinedTo')}
                onChange={(event) => filters.set({ joinedTo: event.target.value })}
              />
            )}
          </Field>

          <div className="flex items-end">
            <Button
              variant="secondary"
              className="w-full"
              disabled={filters.activeCount(ALL_FILTERS) === 0}
              onClick={() => filters.clear()}
            >
              <X aria-hidden />
              Clear all filters
            </Button>
          </div>
        </div>
      ) : null}
    </>
  );

  return (
    <TableFrame framed={!creating} header={header} toolbar={toolbar}>
      {/* "None match" and "there are none" are different facts, and telling
          an admin the wrong one sends them looking in the wrong place. Any
          filter at all means the former. */}
      <DataTable
        columns={columns}
        rows={students.items}
        rowKey={(student) => student.id}
        isLoading={students.isLoading}
        empty={
          filters.activeCount(ALL_FILTERS) > 0
            ? 'No students match those filters.'
            : 'No students yet. Add one, or import a roster.'
        }
        footer={students.hasLoaded ? <Pagination {...students.pagination} /> : null}
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
  'currentBranchId',
] as const;

/** Adds a student before signup. The mobile is the join key, so the OTP flow upserts onto this row. */
function NewStudentCard({ onClose }: Readonly<{ onClose: () => void }>) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const form = useForm<CreateStudentInput>({
    resolver: zodResolver(createStudentSchema),
    defaultValues: {
      mobile: '',
      fullName: '',
      studentType: STUDENT_TYPE.ONLINE,
      enrolledExams: [],
      currentBranchId: '',
    },
  });

  const enrolledExams = useWatch({ control: form.control, name: 'enrolledExams' }) ?? [];
  const currentBranchId = useWatch({ control: form.control, name: 'currentBranchId' }) ?? '';
  const exams = useExams({ activeOnly: true });
  const branches = useBranches({ activeOnly: true });

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
        // An untouched picker is "not recorded"; '' is not a branch id the server could resolve.
        currentBranchId: values.currentBranchId || undefined,
      }),
    onSuccess: (student) => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'students'] });
      void navigate(ROUTES.STUDENT(student.id));
    },
    onError: (error) => applyFieldErrors(error, form.setError, NEW_STUDENT_FIELDS),
  });

  return (
    <Card className="mb-5">
      <CardHeader>
        <CardTitle>Add a student</CardTitle>
        <CardDescription>
          The mobile number and the student type are required. They will set their own PIN the first
          time they sign in, and land on this same record.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="flex flex-col gap-4"
          onSubmit={form.handleSubmit((values) => create.mutate(values))}
          noValidate
        >
          <div className="flex flex-wrap gap-4">
            <FormField form={form} name="mobile" label="Mobile number" className="min-w-56 flex-1">
              {(control) => (
                <NumericInput
                  {...control}
                  autoFocus
                  prefix="+91"
                  // Room to paste a +91-prefixed number; normaliseMobile trims
                  // it back rather than truncating to the wrong ten digits.
                  maxLength={15}
                  sanitize={(raw) => normaliseMobile(digitsOnly(raw)).slice(0, MOBILE_DIGITS)}
                  placeholder="98765 43210"
                  className="tabular-nums"
                />
              )}
            </FormField>

            <FormField
              form={form}
              name="fullName"
              label="Full name"
              hint="Optional — they can fill it in themselves"
              className="min-w-56 flex-1"
            >
              {(control) => <Input {...control} />}
            </FormField>
          </div>

          <div className="flex flex-wrap gap-4">
            <FormField
              form={form}
              name="studentType"
              label="Student type"
              className="min-w-56 flex-1"
            >
              {(control) => (
                <Select {...control}>
                  {STUDENT_TYPES.map((value) => (
                    <option key={value} value={value}>
                      {STUDENT_TYPE_LABELS[value]}
                    </option>
                  ))}
                </Select>
              )}
            </FormField>

            <FormField
              form={form}
              name="enrolledExams"
              label="Enrolled exams"
              hint="How they reach a test series"
              className="min-w-56 flex-1"
            >
              {({ id, 'aria-describedby': describedBy, 'aria-invalid': invalid }) => (
                <MultiCombobox
                  id={id}
                  aria-describedby={describedBy}
                  aria-invalid={invalid}
                  value={enrolledExams}
                  onChange={(next) => form.setValue('enrolledExams', next, { shouldDirty: true })}
                  items={exams.map((exam) => ({
                    value: exam.code,
                    label: exam.code,
                    hint: exam.name,
                  }))}
                  placeholder="None yet"
                  emptyLabel="No exam matches that"
                />
              )}
            </FormField>

            <FormField
              form={form}
              name="currentBranchId"
              label="Current branch"
              hint="Without one they reach no series"
              className="min-w-56 flex-1"
            >
              {({ id, 'aria-describedby': describedBy, 'aria-invalid': invalid }) => (
                <Combobox
                  id={id}
                  aria-describedby={describedBy}
                  aria-invalid={invalid}
                  value={currentBranchId}
                  onChange={(next) => form.setValue('currentBranchId', next, { shouldDirty: true })}
                  items={branches.map((branch) => ({ value: branch.id, label: branch.name }))}
                  placeholder="Not recorded"
                  emptyLabel="No branch matches that"
                />
              )}
            </FormField>
          </div>

          <div className="flex gap-2">
            <Button type="submit" loading={create.isPending}>
              Add student
            </Button>
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------

/** Pulls students from the main portal. Super admin only, and a stub today — it says so. */
function SyncStudentsButton() {
  const { identity: admin } = useAuth();
  const [confirming, setConfirming] = useState(false);

  const sync = useMutation({
    mutationFn: () => api.admin.sync.students(),
    onSuccess: (result) => {
      setConfirming(false);
      toast.info(result.message);
    },
  });

  if (!admin?.isSuperAdmin) return null;

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        icon={<RefreshCw aria-hidden />}
        loading={sync.isPending}
        onClick={() => setConfirming(true)}
        title="Pull students from the main portal"
      >
        Sync from portal
      </Button>

      {/* One click, an unknown number of student records written from a system
          this screen does not control, and no preview of what is about to
          change — the three things that make an action worth asking about. Its
          neighbours on this page (import, add student) each show what they
          would do before they do it; this one cannot, so it asks instead. */}
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        loading={sync.isPending}
        title="Pull students from the main portal?"
        description="Every student the portal returns is created here, or updated if they already exist. There is no preview and no undo — what the portal says is what this roster will hold."
        confirmLabel="Pull from portal"
        onConfirm={() => sync.mutate()}
      />
    </>
  );
}
