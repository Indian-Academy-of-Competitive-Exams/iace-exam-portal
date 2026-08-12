import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Search, Upload, UserPlus, X } from 'lucide-react';
import { type StudentSummary } from '@iace/contracts';
import {
  Alert,
  Badge,
  Button,
  Card,
  Input,
  Select,
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
} from '@iace/ui';
import { PageHeader } from '../components/app-shell';
import { Pagination } from '../components/pagination';
import { api } from '../lib/api';
import { ROUTES } from '../lib/constants';
import { bannerMessage } from '../lib/form-errors';

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

  // Set when arriving from a batch. Batch members are this list filtered, not a
  // second screen that would drift from it.
  const [searchParams, setSearchParams] = useSearchParams();
  const groupId = searchParams.get('groupId') ?? undefined;

  const batch = useQuery({
    queryKey: ['admin', 'group', groupId],
    queryFn: () => api.admin.groups.detail(groupId ?? ''),
    enabled: Boolean(groupId),
  });

  const students = useQuery({
    queryKey: ['admin', 'students', { search, status, page, groupId }],
    queryFn: () => api.admin.students.list({ q: search, page, groupId, ...STATUS_QUERY[status] }),
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

      <Card className="p-4">
        {groupId ? (
          <div className="mb-4 flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Showing the batch</span>
            <Badge variant="primary">{batch.data?.name ?? '…'}</Badge>
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
              <TableHead>Batches</TableHead>
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
        <Link
          to={ROUTES.STUDENT(student.id)}
          className="rounded-sm font-medium text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:shadow-focus"
        >
          {student.fullName ?? <span className="text-muted-foreground">No name yet</span>}
        </Link>
      </TableCell>

      <TableCell className="tabular-nums text-muted-foreground">{student.mobile}</TableCell>

      <TableCell>
        {student.groups.length === 0 ? (
          // A student in no batch can reach no test, so this is a problem to
          // show rather than an empty cell.
          <Badge variant="warning">No batch</Badge>
        ) : (
          <div className="flex flex-wrap gap-1">
            {student.groups.map((group) => (
              <Badge key={group.id}>{group.name}</Badge>
            ))}
          </div>
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
