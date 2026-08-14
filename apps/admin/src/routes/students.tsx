import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  ChevronDown,
  Loader2,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Upload,
  UserPlus,
  X,
} from 'lucide-react';
import {
  FEATURE_KEYS,
  MOBILE_DIGITS,
  PERMISSION_LEVELS,
  PAGE_SIZE_MAX,
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
  BadgeList,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  cn,
  Combobox,
  DataTable,
  digitsOnly,
  Field,
  FormField,
  Input,
  linkVariants,
  NumericInput,
  PageHeader,
  Pagination,
  Select,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TruncatedText,
  useTruncation,
  type DataTableColumn,
  toast,
} from '@iace/ui';
import { GroupPicker } from '../components/group-picker';
import { api } from '../lib/api';
import { ROUTES } from '../lib/constants';
import { applyFieldErrors, useInfinitePages, useListQuery } from '@iace/app-kit';
import { useBranches } from '../lib/use-branches';
import { useFilters } from '../lib/use-filters';
import { useAuth } from '../providers/auth';
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
  const { can } = useAuth();
  const canWrite = can(FEATURE_KEYS.STUDENT_MANAGEMENT, PERMISSION_LEVELS.WRITE);
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

  // The page resets itself whenever `query` changes, and the rows hold still
  // while the next one arrives — see useListQuery.
  const students = useListQuery({
    queryKey: ['admin', 'students'],
    filters: query,
    fetchPage: (params) => api.admin.students.list(params),
  });

  const columns = useMemo<DataTableColumn<StudentSummary>[]>(
    () => [
      { key: 'name', header: 'Student', cell: (s) => <StudentNameCell student={s} /> },
      {
        key: 'mobile',
        header: 'Mobile',
        className: 'tabular-nums text-muted-foreground',
        cell: (s) => s.mobile,
      },
      {
        key: 'groups',
        header: 'Groups',
        cell: (s) =>
          s.groups.length === 0 ? (
            // A student in no group can reach no test, so this is a problem to
            // show rather than an empty cell.
            <Badge variant="warning">No group</Badge>
          ) : (
            <GroupsCell groups={s.groups} />
          ),
      },
      { key: 'status', header: 'Status', cell: (s) => <SignInStatus student={s} /> },
      {
        key: 'pretest',
        header: 'Pre-test details',
        cell: (s) => (
          <Badge variant={s.preTestReady ? 'success' : 'neutral'}>
            {s.preTestReady ? 'On file' : 'Needed'}
          </Badge>
        ),
      },
    ],
    [],
  );

  return (
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
            <Button
              variant="ghost"
              size="sm"
              onClick={() => filters.set({ groupId: '', branchId: '' })}
            >
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
              onChange={(event) => filters.set({ q: event.target.value })}
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
              <option value="inactive">Deactivated</option>
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
                  // Clearing the group too: a group belongs to one branch, so
                  // keeping both would usually mean asking for an empty set.
                  onChange={(event) => filters.set({ branchId: event.target.value, groupId: '' })}
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
                  onChange={(next) => filters.set({ groupId: next })}
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
              htmlFor="filter-ungrouped"
              label="Group membership"
              hint="A student in no group can reach no test."
            >
              {(control) => (
                <Select
                  {...control}
                  value={filters.get('ungrouped')}
                  onChange={(event) => filters.set({ ungrouped: event.target.value })}
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
      </Card>
    </>
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
  return (
    <BadgeList
      items={groups}
      label={(group) => group.name}
      className="max-w-[12rem]"
      // The visible one is still truncated to the column: a long group name
      // would otherwise widen the cell on its own.
    >
      {(group) => (
        <Badge className="min-w-0 shrink">
          <TruncatedText>{group.name}</TruncatedText>
        </Badge>
      )}
    </BadgeList>
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

// ---------------------------------------------------------------------------

/**
 * Pull students from the institute's main portal.
 *
 * Super admin only, and a no-op today: the endpoint, the types and this button
 * are finished, and the service body is a stub. It reports what actually
 * happened rather than claiming success, because a button that says "Synced"
 * while doing nothing is worse than one that says it is not built yet.
 */
function SyncStudentsButton() {
  const { identity: admin } = useAuth();

  const sync = useMutation({
    mutationFn: () => api.admin.sync.students(),
    onSuccess: (result) => toast.info(result.message),
  });

  if (!admin?.isSuperAdmin) return null;

  return (
    <Button
      variant="outline"
      size="sm"
      disabled={sync.isPending}
      onClick={() => sync.mutate()}
      title="Pull students from the main portal"
    >
      {sync.isPending ? (
        <Loader2 className="animate-spin" aria-hidden />
      ) : (
        <RefreshCw aria-hidden />
      )}
      Sync from portal
    </Button>
  );
}
