import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { ChevronDown, Loader2, Search, SlidersHorizontal, Upload, UserPlus, X } from 'lucide-react';
import {
  MOBILE_DIGITS,
  PAGE_SIZE_MAX,
  PAGE_SIZE_OPTIONS,
  STUDENT_SORTS,
  todayISO,
  createStudentSchema,
  normaliseMobile,
  type CreateStudentInput,
  type GroupRef,
  type StudentSort,
  type StudentSummary,
} from '@iace/contracts';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Combobox,
  Field,
  Input,
  NumericInput,
  Pagination,
  Select,
  Table,
  TableBody,
  TableCell,
  TableState,
  TableHead,
  TableHeader,
  TableRow,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TruncatedText,
  cn,
  digitsOnly,
  linkVariants,
  useTruncation,
} from '@iace/ui';
import { PageHeader } from '../components/app-shell';
import { GroupPicker } from '../components/group-picker';
import { api } from '../lib/api';
import { ROUTES } from '../lib/constants';
import { applyFieldErrors, useInfinitePages, usePageSize } from '@iace/app-kit';
import { useBranches } from '../lib/use-branches';
import { useFilters } from '../lib/use-filters';
type StatusFilter = 'all' | 'active' | 'inactive' | 'invited' | 'defaultpin';

/** Every filter this screen owns. Named once so "clear all" cannot miss one. */
const ALL_FILTERS = [
  'q',
  'status',
  'sort',
  'branchId',
  'groupId',
  'preTestReady',
  'profileCompleted',
  'ungrouped',
  'joinedFrom',
  'joinedTo',
] as const;
type FilterKey = (typeof ALL_FILTERS)[number];

/** The ones behind the "Filters" fold — what the count on the button counts. */
const EXTRA_FILTERS = ALL_FILTERS.filter(
  (key) => !['q', 'status', 'sort'].includes(key),
) as readonly FilterKey[];

/**
 * The query params take 'true' | 'false' — a filter is absent or applied, and
 * `false` is a question ("not ready yet") rather than "don't care".
 */
function asBooleanParam(value: string): 'true' | 'false' | undefined {
  return value === 'true' || value === 'false' ? value : undefined;
}

/** Each filter is one query shape; keeping them together stops them contradicting. */
const STATUS_QUERY: Record<
  StatusFilter,
  { isActive?: 'true' | 'false'; neverSignedIn?: 'true'; hasDefaultPin?: 'true' }
> = {
  all: {},
  active: { isActive: 'true' },
  inactive: { isActive: 'false' },
  invited: { neverSignedIn: 'true' },
  defaultpin: { hasDefaultPin: 'true' },
};

export function StudentsPage() {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = usePageSize();
  const [showAll, setShowAll] = useState(false);

  // Every filter lives in the URL, so a link into this screen — from a group,
  // from a branch — and the controls on it are the same state. See useFilters.
  const filters = useFilters<FilterKey>();
  const [searchParams, setSearchParams] = useSearchParams();
  // The "Add student" button links here; reading it is what makes it work.
  const creating = searchParams.get('new') === '1';

  const groupId = filters.get('groupId');
  const branchId = filters.get('branchId');
  const status = (filters.get('status') || 'all') as StatusFilter;

  const branches = useBranches();
  const branch = branches.find((candidate) => candidate.id === branchId);

  // Declared before the group list, which uses it to decide whether to fetch.
  const extraCount = filters.activeCount(EXTRA_FILTERS);
  const filtersOpen = showAll || extraCount > 0;

  /**
   * Every group, a page at a time.
   *
   * A plain select over one capped request ends at the first hundred and looks
   * complete — a multi-branch institute's later groups would simply not exist
   * as far as this filter is concerned. The search is server-side for the same
   * reason: filtering what happens to be loaded is not filtering.
   */
  const [groupSearch, setGroupSearch] = useState('');
  const groupPages = useInfinitePages({
    queryKey: ['admin', 'groups', 'filter', branchId, groupSearch],
    fetchPage: (page) =>
      // PAGE_SIZE_MAX per request — the cap stays what it was; what changed is
      // that reaching the end of one page now fetches the next instead of
      // being where the list quietly stops.
      api.admin.groups.list({
        page,
        pageSize: PAGE_SIZE_MAX,
        q: groupSearch,
        branchId: branchId || undefined,
      }),
    // Only while the dropdown can be opened — the panel is folded away by default.
    enabled: filtersOpen,
  });

  const group = useQuery({
    queryKey: ['admin', 'group', groupId],
    queryFn: () => api.admin.groups.detail(groupId),
    enabled: groupId !== '',
  });

  const query = {
    q: filters.get('q') || undefined,
    groupId: groupId || undefined,
    branchId: branchId || undefined,
    preTestReady: asBooleanParam(filters.get('preTestReady')),
    profileCompleted: asBooleanParam(filters.get('profileCompleted')),
    ungrouped: asBooleanParam(filters.get('ungrouped')),
    joinedFrom: filters.get('joinedFrom') || undefined,
    joinedTo: filters.get('joinedTo') || undefined,
    sort: (filters.get('sort') || undefined) as StudentSort | undefined,
    ...STATUS_QUERY[status],
  };

  const students = useQuery({
    queryKey: ['admin', 'students', { ...query, page, pageSize }],
    queryFn: () => api.admin.students.list({ ...query, page, pageSize }),
    // Without this the table empties on every keystroke and the page jumps;
    // holding the previous page keeps the rows still while the next arrives.
    placeholderData: keepPreviousData,
  });

  const set = (changes: Partial<Record<FilterKey, string | undefined>>) => {
    filters.set(changes);
    setPage(1);
  };

  return (
    <>
      <PageHeader
        title="Students"
        description="Everyone enrolled, however they got here — self-signup, added by hand, or imported."
        action={
          <div className="flex gap-2">
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

      <Card className="p-4">
        {/* Arrived from somewhere: say where, and offer the way back out. */}
        {group.data || branch ? (
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted-foreground">Showing</span>
            {branch ? (
              <Badge variant={branch.isGlobal ? 'info' : 'primary'}>{branch.name}</Badge>
            ) : null}
            {group.data ? (
              <Badge variant="primary">
                {group.data.branch.name} / {group.data.name}
              </Badge>
            ) : null}
            <Button variant="ghost" size="sm" onClick={() => set({ groupId: '', branchId: '' })}>
              <X aria-hidden />
              Clear
            </Button>
          </div>
        ) : null}

        <div className="mb-3 flex flex-wrap gap-3">
          <div className="min-w-56 flex-1">
            <Input
              aria-label="Search students"
              placeholder="Search by name or mobile"
              value={filters.get('q')}
              prefix={<Search className="size-4" aria-hidden />}
              onChange={(event) => set({ q: event.target.value })}
            />
          </div>

          <div className="w-44">
            <Select
              aria-label="Filter by status"
              value={status}
              onChange={(event) => set({ status: event.target.value })}
            >
              <option value="all">All students</option>
              <option value="active">Active</option>
              <option value="inactive">Deactivated</option>
              <option value="invited">Never signed in</option>
              <option value="defaultpin">Still on the default PIN</option>
            </Select>
          </div>

          <div className="w-44">
            <Select
              aria-label="Sort by"
              value={filters.get('sort') || STUDENT_SORTS.RECENT}
              onChange={(event) => set({ sort: event.target.value })}
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
                  // Clearing the group too: a group belongs to one branch, so
                  // keeping both would usually mean asking for an empty set.
                  onChange={(event) => set({ branchId: event.target.value, groupId: '' })}
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

            <Field htmlFor="filter-group" label="Group">
              {(control) => (
                <Combobox
                  {...control}
                  value={groupId}
                  onChange={(next) => set({ groupId: next })}
                  // The chosen group is very often outside the page that
                  // happens to be loaded; without this the control would look
                  // like it had lost the selection.
                  selectedLabel={
                    group.data ? `${group.data.branch.name} / ${group.data.name}` : undefined
                  }
                  items={groupPages.items.map((option) => ({
                    value: option.id,
                    label: option.name,
                    hint: option.branch.name,
                  }))}
                  placeholder="Any group"
                  search={groupSearch}
                  onSearchChange={setGroupSearch}
                  searchPlaceholder="Search groups"
                  hasMore={groupPages.hasMore}
                  onLoadMore={groupPages.loadMore}
                  isLoading={groupPages.isLoading}
                  isLoadingMore={groupPages.isLoadingMore}
                  emptyLabel="No group matches that"
                />
              )}
            </Field>

            <Field htmlFor="filter-pretest" label="Pre-test details">
              {(control) => (
                <Select
                  {...control}
                  value={filters.get('preTestReady')}
                  onChange={(event) => set({ preTestReady: event.target.value })}
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
                  onChange={(event) => set({ profileCompleted: event.target.value })}
                >
                  <option value="">Any</option>
                  <option value="true">Complete</option>
                  <option value="false">Incomplete</option>
                </Select>
              )}
            </Field>

            <Field
              htmlFor="filter-ungrouped"
              label="Group membership"
              hint="A student in no group can reach no test."
            >
              {(control) => (
                <Select
                  {...control}
                  value={filters.get('ungrouped')}
                  onChange={(event) => set({ ungrouped: event.target.value })}
                >
                  <option value="">Any</option>
                  <option value="true">In no group</option>
                  <option value="false">In at least one</option>
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
                  onChange={(event) => set({ joinedFrom: event.target.value })}
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
                  onChange={(event) => set({ joinedTo: event.target.value })}
                />
              )}
            </Field>

            <div className="flex items-end">
              <Button
                variant="secondary"
                className="w-full"
                disabled={filters.activeCount(ALL_FILTERS) === 0}
                onClick={() => {
                  filters.clear();
                  setPage(1);
                }}
              >
                <X aria-hidden />
                Clear all filters
              </Button>
            </div>
          </div>
        ) : null}

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Student</TableHead>
              <TableHead>Mobile</TableHead>
              <TableHead>Groups</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Pre-test details</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {/* "None match" and "there are none" are different facts, and
                telling an admin the wrong one sends them looking in the wrong
                place. Any filter at all means the former. */}
            <TableState
              isLoading={students.isPending}
              isEmpty={!students.data?.items.length}
              colSpan={5}
              empty={
                filters.activeCount(ALL_FILTERS) > 0
                  ? 'No students match those filters.'
                  : 'No students yet. Add one, or import a roster.'
              }
            >
              {students.data?.items.map((student) => (
                <StudentRow key={student.id} student={student} />
              ))}
            </TableState>
          </TableBody>
        </Table>

        {students.data ? (
          <Pagination
            page={students.data.page}
            pageSize={students.data.pageSize}
            total={students.data.total}
            onPageChange={setPage}
            pageSizeOptions={PAGE_SIZE_OPTIONS}
            onPageSizeChange={(size) => {
              setPageSize(size);
              // Page 9 of 20-per-page may not exist at 100 per page, and
              // landing on an empty table reads as "the rows are gone".
              setPage(1);
            }}
          />
        ) : null}
      </Card>
    </>
  );
}

function StudentRow({ student }: Readonly<{ student: StudentSummary }>) {
  return (
    <TableRow>
      <TableCell>
        <StudentNameCell student={student} />
      </TableCell>

      <TableCell className="tabular-nums text-muted-foreground">{student.mobile}</TableCell>

      <TableCell>
        {student.groups.length === 0 ? (
          // A student in no group can reach no test, so this is a problem to
          // show rather than an empty cell.
          <Badge variant="warning">No group</Badge>
        ) : (
          <GroupsCell groups={student.groups} />
        )}
      </TableCell>

      <TableCell>
        <SignInStatus student={student} />
      </TableCell>

      <TableCell>
        <Badge variant={student.preTestReady ? 'success' : 'neutral'}>
          {student.preTestReady ? 'On file' : 'Needed'}
        </Badge>
      </TableCell>
    </TableRow>
  );
}

/**
 * Where a student is with signing in — four states, in the order they matter.
 *
 * Written as a list rather than a chain of ternaries because that is what it
 * is: adding a fifth state to a nested conditional means finding the right rung
 * of the ladder, and putting it on the wrong one silently hides another.
 */
function SignInStatus({ student }: Readonly<{ student: StudentSummary }>) {
  if (!student.isActive) return <Badge variant="danger">Deactivated</Badge>;
  if (student.hasSignedIn) return <Badge variant="success">Active</Badge>;
  // Its own state on purpose: they CAN sign in, but on a PIN anyone holding the
  // roster can work out. "Never signed in" would hide that.
  if (student.hasDefaultPin) return <Badge variant="warning">Default PIN</Badge>;
  return <Badge variant="info">Never signed in</Badge>;
}

/**
 * The student's name, capped so one long name cannot widen the column.
 *
 * The tooltip hangs off the link rather than a span inside it, so the same
 * thing that reveals the full name on hover reveals it on keyboard focus —
 * there is one target, not a focusable link wrapping a hoverable span.
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

/**
 * A student's groups, in exactly one line however many there are.
 *
 * Listing them all wrapped the cell over several lines and let one long,
 * admin-typed group name widen the column until the rest of the table was
 * pushed sideways — the row height stopped matching its neighbours and the
 * columns stopped lining up. So: the first name, truncated to the column, and a
 * count standing in for the rest. Hovering either reveals what was cut, and the
 * group filter above the table is the way to actually see who is in what.
 */
function GroupsCell({ groups }: Readonly<{ groups: GroupRef[] }>) {
  const [first, ...rest] = groups;
  if (!first) return null;

  return (
    <div className="flex max-w-[12rem] items-center gap-1">
      <Badge className="min-w-0 shrink">
        <TruncatedText>{first.name}</TruncatedText>
      </Badge>

      {rest.length > 0 ? (
        // Not a truncation: these names are hidden however wide the column
        // gets, so this one always has something to say.
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge variant="neutral" tabIndex={0} className="focus-visible:shadow-focus">
              +{rest.length}
            </Badge>
          </TooltipTrigger>
          <TooltipContent>{rest.map((group) => group.name).join('\n')}</TooltipContent>
        </Tooltip>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------

const NEW_STUDENT_FIELDS = ['mobile', 'fullName', 'groupIds'] as const;

/**
 * Adds a student before they have signed up.
 *
 * The mobile number is the join key: when they later sign up with it, the OTP
 * flow upserts onto THIS row, so the groups picked here are already in place
 * rather than lost to a duplicate.
 */
function NewStudentCard({ onClose }: Readonly<{ onClose: () => void }>) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const form = useForm<CreateStudentInput>({
    resolver: zodResolver(createStudentSchema),
    defaultValues: { mobile: '', fullName: '', groupIds: [] },
  });

  const selectedGroupIds = useWatch({ control: form.control, name: 'groupIds' }) ?? [];

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
        groupIds: values.groupIds?.length ? values.groupIds : undefined,
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
          Only the mobile number is required. They will set their own PIN the first time they sign
          in, and land on this same record.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="flex flex-col gap-4"
          onSubmit={form.handleSubmit((values) => create.mutate(values))}
          noValidate
        >
          <div className="flex flex-wrap gap-4">
            <div className="min-w-56 flex-1">
              <Field
                htmlFor="mobile"
                label="Mobile number"
                error={form.formState.errors.mobile?.message}
              >
                {(control) => (
                  <NumericInput
                    {...control}
                    {...form.register('mobile')}
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
              </Field>
            </div>
            <div className="min-w-56 flex-1">
              <Field
                htmlFor="fullName"
                label="Full name"
                hint="Optional — they can fill it in themselves"
                error={form.formState.errors.fullName?.message}
              >
                {(control) => <Input {...control} {...form.register('fullName')} />}
              </Field>
            </div>
          </div>

          <fieldset>
            <legend className="mb-1.5 text-sm font-medium text-foreground">Groups</legend>
            <GroupPicker
              idPrefix="new-group"
              register={form.register('groupIds')}
              selectedIds={selectedGroupIds}
              known={[]}
              error={form.formState.errors.groupIds?.message}
            />
          </fieldset>

          <div className="flex gap-2">
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
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
