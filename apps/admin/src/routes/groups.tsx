import { useState } from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2, Plus, Search, Trash2 } from 'lucide-react';
import {
  PAGE_SIZE_OPTIONS,
  createGroupSchema,
  type CreateGroupInput,
  type GroupSummary,
} from '@iace/contracts';
import {
  Alert,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Badge,
  Field,
  Input,
  Select,
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
  linkVariants,
} from '@iace/ui';
import { PageHeader } from '../components/app-shell';
import { Pagination } from '@iace/ui';
import { api } from '../lib/api';
import { ROUTES } from '../lib/constants';
import { useBranches } from '../lib/use-branches';
import { usePageSize } from '@iace/app-kit';
import { applyFieldErrors, bannerMessage } from '@iace/app-kit';

const NEW_GROUP_FIELDS = ['name', 'branchId'] as const;

export function GroupsPage() {
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState('');
  const [branchId, setBranchId] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = usePageSize();
  const queryClient = useQueryClient();

  const groups = useQuery({
    queryKey: ['admin', 'groups', { search, branchId, page, pageSize }],
    queryFn: () =>
      api.admin.groups.list({ q: search, page, pageSize, branchId: branchId || undefined }),
    // Holds the rows still while the next page arrives, instead of blanking
    // the table on every keystroke.
    placeholderData: keepPreviousData,
  });

  const allBranches = useBranches();

  return (
    <>
      <PageHeader
        title="Groups"
        description="The unit that grants access: a student reaches a test through the group they are in."
        action={
          <Button size="sm" onClick={() => setCreating((open) => !open)}>
            <Plus aria-hidden />
            New group
          </Button>
        }
      />

      {creating ? (
        <NewGroupCard
          onDone={() => {
            setCreating(false);
            void queryClient.invalidateQueries({ queryKey: ['admin', 'groups'] });
          }}
          onCancel={() => setCreating(false)}
        />
      ) : null}

      <Card className="p-4">
        <div className="mb-4 flex flex-wrap gap-3">
          <div className="min-w-56 flex-1">
            <Input
              aria-label="Search groups"
              placeholder="Search by name or branch"
              value={search}
              prefix={<Search className="size-4" aria-hidden />}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
            />
          </div>
          <div className="w-52">
            <Select
              aria-label="Filter by branch"
              value={branchId}
              onChange={(event) => {
                setBranchId(event.target.value);
                setPage(1);
              }}
            >
              <option value="">All branches</option>
              {allBranches.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.name}
                </option>
              ))}
            </Select>
          </div>
        </div>

        {groups.error ? (
          <Alert variant="danger" className="mb-4">
            {bannerMessage(groups.error)}
          </Alert>
        ) : null}

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Group</TableHead>
              <TableHead>Branch</TableHead>
              <TableHead numeric>Students</TableHead>
              <TableHead numeric>Test series</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {groups.isPending ? (
              <TableEmpty colSpan={5}>Loading…</TableEmpty>
            ) : groups.data?.items.length ? (
              groups.data.items.map((group) => <GroupRow key={group.id} group={group} />)
            ) : (
              <TableEmpty colSpan={5}>
                {search
                  ? `No group matches “${search}”.`
                  : 'No groups yet. Create one before adding students.'}
              </TableEmpty>
            )}
          </TableBody>
        </Table>

        {groups.data ? (
          <Pagination
            page={groups.data.page}
            pageSize={groups.data.pageSize}
            total={groups.data.total}
            onPageChange={setPage}
            pageSizeOptions={PAGE_SIZE_OPTIONS}
            onPageSizeChange={(size) => {
              setPageSize(size);
              setPage(1);
            }}
          />
        ) : null}
      </Card>
    </>
  );
}

// ---------------------------------------------------------------------------

function NewGroupCard({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const form = useForm<CreateGroupInput>({
    resolver: zodResolver(createGroupSchema),
    defaultValues: { name: '', branchId: '' },
  });

  // Only ACTIVE branches: a closed centre stays in the list for the groups that
  // already reference it, but nothing new is created under one.
  const branches = useBranches({ activeOnly: true });

  const create = useMutation({
    mutationFn: (values: CreateGroupInput) => api.admin.groups.create(values),
    onSuccess: onDone,
    onError: (error) => applyFieldErrors(error, form.setError, NEW_GROUP_FIELDS),
  });

  return (
    <Card className="mb-5">
      <CardHeader>
        <CardTitle>New group</CardTitle>
        <CardDescription>
          Pick the branch, then name the group. Names are stored in capitals, so &ldquo;SSC CGL
          Morning&rdquo; and &ldquo;ssc cgl morning&rdquo; are the same group and cannot both exist
          in one branch.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="flex flex-wrap items-start gap-4"
          onSubmit={form.handleSubmit((values) => create.mutate(values))}
          noValidate
        >
          <div className="min-w-48 flex-1">
            <Field
              htmlFor="branchId"
              label="Branch"
              error={form.formState.errors.branchId?.message}
              hint="Only a super admin can add a branch."
            >
              {(control) => (
                <Select {...control} {...form.register('branchId')} autoFocus>
                  <option value="">Pick a branch…</option>
                  {branches.map((branch) => (
                    <option key={branch.id} value={branch.id}>
                      {branch.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
          <div className="min-w-56 flex-1">
            <Field htmlFor="name" label="Group name" error={form.formState.errors.name?.message}>
              {(control) => (
                // Shown in capitals as it is typed, because that is what will be
                // stored — the preview would otherwise disagree with the result.
                <Input
                  {...control}
                  {...form.register('name')}
                  className="uppercase placeholder:normal-case"
                  placeholder="SSC CGL MORNING"
                />
              )}
            </Field>
          </div>

          <div className="flex gap-2 pt-[26px]">
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
              Create
            </Button>
            {/* Cancel is neutral grey, never red — it destroys nothing. */}
            <Button type="button" variant="secondary" onClick={onCancel}>
              Cancel
            </Button>
          </div>

          {create.error ? (
            <div className="w-full">
              <Alert variant="danger">{bannerMessage(create.error, NEW_GROUP_FIELDS)}</Alert>
            </div>
          ) : null}
        </form>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------

function GroupRow({ group }: { group: GroupSummary }) {
  const [confirming, setConfirming] = useState(false);
  const queryClient = useQueryClient();

  const remove = useMutation({
    mutationFn: () => api.admin.groups.remove(group.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'groups'] }),
    // Drop out of the confirm on failure, or the row is left asking a question
    // that has already been answered.
    onError: () => setConfirming(false),
  });

  return (
    <>
      <TableRow>
        <TableCell className="font-medium">
          {/* Members are the student list filtered — the same screen, not a copy. */}
          <Link to={`${ROUTES.STUDENTS}?groupId=${group.id}`} className={linkVariants()}>
            {group.name}
          </Link>
        </TableCell>
        <TableCell>
          {group.branch.isGlobal ? (
            <Badge variant="info">{group.branch.name}</Badge>
          ) : (
            <span className="text-muted-foreground">{group.branch.name}</span>
          )}
        </TableCell>
        <TableCell numeric>{group.studentCount}</TableCell>
        <TableCell numeric>{group.testSeriesCount}</TableCell>
        <TableCell className="text-right">
          {confirming ? (
            <span className="inline-flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Delete?</span>
              <Button
                size="sm"
                variant="destructive"
                disabled={remove.isPending}
                onClick={() => remove.mutate()}
              >
                Yes, delete
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setConfirming(false)}>
                Cancel
              </Button>
            </span>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              aria-label={`Delete ${group.name}`}
              onClick={() => {
                // Clear the last refusal: it described the group as it was
                // before the admin went and moved the students.
                remove.reset();
                setConfirming(true);
              }}
            >
              <Trash2 aria-hidden />
            </Button>
          )}
        </TableCell>
      </TableRow>

      {remove.error ? (
        <tr>
          <TableCell colSpan={5} className="pt-0">
            {/* The server refuses while students or a series still depend on it,
                and its message says what to do first. */}
            <Alert variant="danger">{bannerMessage(remove.error)}</Alert>
          </TableCell>
        </tr>
      ) : null}
    </>
  );
}
