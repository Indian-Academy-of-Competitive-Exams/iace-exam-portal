import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2, Search, Upload, UserPlus, X } from 'lucide-react';
import {
  MOBILE_DIGITS,
  createStudentSchema,
  normaliseMobile,
  type CreateStudentInput,
  type GroupRef,
  type StudentSummary,
} from '@iace/contracts';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Field,
  Input,
  NumericInput,
  Select,
  digitsOnly,
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TruncatedText,
  useTruncation,
} from '@iace/ui';
import { PageHeader } from '../components/app-shell';
import { GroupPicker } from '../components/group-picker';
import { Pagination } from '../components/pagination';
import { api } from '../lib/api';
import { ROUTES } from '../lib/constants';
import { usePageSize } from '../lib/use-page-size';
import { applyFieldErrors, bannerMessage } from '../lib/form-errors';

type StatusFilter = 'all' | 'active' | 'inactive' | 'invited';

/** Each filter is one query shape; keeping them together stops them contradicting. */
const STATUS_QUERY: Record<StatusFilter, { isActive?: 'true' | 'false'; neverSignedIn?: 'true' }> =
  {
    all: {},
    active: { isActive: 'true' },
    inactive: { isActive: 'false' },
    invited: { neverSignedIn: 'true' },
  };

export function StudentsPage() {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = usePageSize();

  // Set when arriving from a group. Group members are this list filtered, not a
  // second screen that would drift from it.
  const [searchParams, setSearchParams] = useSearchParams();
  const groupId = searchParams.get('groupId') ?? undefined;
  // The "Add student" button links here; reading it is what makes it work.
  const creating = searchParams.get('new') === '1';

  const group = useQuery({
    queryKey: ['admin', 'group', groupId],
    queryFn: () => api.admin.groups.detail(groupId ?? ''),
    enabled: Boolean(groupId),
  });

  const students = useQuery({
    queryKey: ['admin', 'students', { search, status, page, pageSize, groupId }],
    queryFn: () =>
      api.admin.students.list({ q: search, page, pageSize, groupId, ...STATUS_QUERY[status] }),
    // Without this the table empties on every keystroke and the page jumps;
    // holding the previous page keeps the rows still while the next arrives.
    placeholderData: keepPreviousData,
  });

  const reset = (next: () => void) => {
    next();
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
        {groupId ? (
          <div className="mb-4 flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Showing the group</span>
            <Badge variant="primary">{group.data?.name ?? '…'}</Badge>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSearchParams({});
                setPage(1);
              }}
            >
              <X aria-hidden />
              Clear
            </Button>
          </div>
        ) : null}

        <div className="mb-4 flex flex-wrap gap-3">
          <div className="min-w-56 flex-1">
            <Input
              aria-label="Search students"
              placeholder="Search by name or mobile"
              value={search}
              prefix={<Search className="size-4" aria-hidden />}
              onChange={(event) => reset(() => setSearch(event.target.value))}
            />
          </div>
          <div className="w-44">
            <Select
              aria-label="Filter by status"
              value={status}
              onChange={(event) => reset(() => setStatus(event.target.value as StatusFilter))}
            >
              <option value="all">All students</option>
              <option value="active">Active</option>
              <option value="inactive">Deactivated</option>
              <option value="invited">Never signed in</option>
            </Select>
          </div>
        </div>

        {students.error ? (
          <Alert variant="danger" className="mb-4">
            {bannerMessage(students.error)}
          </Alert>
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
            {students.isPending ? (
              <TableEmpty colSpan={5}>Loading…</TableEmpty>
            ) : students.data?.items.length ? (
              students.data.items.map((student) => (
                <StudentRow key={student.id} student={student} />
              ))
            ) : (
              <TableEmpty colSpan={5}>
                {search || status !== 'all' || groupId
                  ? 'No students match that.'
                  : 'No students yet. Add one, or import a roster.'}
              </TableEmpty>
            )}
          </TableBody>
        </Table>

        {students.data ? (
          <Pagination
            page={students.data.page}
            pageSize={students.data.pageSize}
            total={students.data.total}
            onPageChange={setPage}
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

function StudentRow({ student }: { student: StudentSummary }) {
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
        {!student.isActive ? (
          <Badge variant="danger">Deactivated</Badge>
        ) : student.hasSignedIn ? (
          <Badge variant="success">Active</Badge>
        ) : (
          <Badge variant="info">Never signed in</Badge>
        )}
      </TableCell>

      <TableCell>
        {student.preTestReady ? (
          <Badge variant="success">On file</Badge>
        ) : (
          <Badge variant="neutral">Needed</Badge>
        )}
      </TableCell>
    </TableRow>
  );
}

/**
 * The student's name, capped so one long name cannot widen the column.
 *
 * The tooltip hangs off the link rather than a span inside it, so the same
 * thing that reveals the full name on hover reveals it on keyboard focus —
 * there is one target, not a focusable link wrapping a hoverable span.
 */
function StudentNameCell({ student }: { student: StudentSummary }) {
  const name = student.fullName;
  const { ref, truncated } = useTruncation<HTMLAnchorElement>(name);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link
          ref={ref}
          to={ROUTES.STUDENT(student.id)}
          className="block max-w-[15rem] truncate rounded-sm font-medium text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:shadow-focus"
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
function GroupsCell({ groups }: { groups: GroupRef[] }) {
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
function NewStudentCard({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const form = useForm<CreateStudentInput>({
    resolver: zodResolver(createStudentSchema),
    defaultValues: { mobile: '', fullName: '', groupIds: [] },
  });

  const selectedGroupIds = useWatch({ control: form.control, name: 'groupIds' }) ?? [];

  const create = useMutation({
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

          {create.error ? (
            <Alert variant="danger">{bannerMessage(create.error, NEW_STUDENT_FIELDS)}</Alert>
          ) : null}

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
