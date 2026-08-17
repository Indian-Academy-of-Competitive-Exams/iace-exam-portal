import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Plus, Trash2, UserPlus, X } from 'lucide-react';
import { createGroupSchema, type CreateGroupInput, type GroupSummary } from '@iace/contracts';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  DataTable,
  FormActions,
  FormField,
  FormRow,
  Input,
  linkVariants,
  PageHeader,
  Pagination,
  SearchInput,
  Select,
  type DataTableColumn,
} from '@iace/ui';
import { api } from '../lib/api';
import { useAuth } from '../providers/auth';
import { ROUTES } from '../lib/constants';
import { useBranches } from '../lib/use-branches';
import { applyFieldErrors, useListQuery } from '@iace/app-kit';
import { FEATURE_KEYS, PERMISSION_LEVELS } from '@iace/contracts';
import { useFilters } from '../lib/use-filters';
const NEW_GROUP_FIELDS = ['name', 'branchId'] as const;

/**
 * The column set, built OUTSIDE the component.
 *
 * `cell` is a render prop — an arrow returning JSX — and a static analyser
 * cannot tell that apart from a component declared inside another component,
 * which is a real bug (a new component type every render, so React remounts
 * the subtree and loses its state). Defining them out here makes the
 * distinction explicit rather than something a reader has to infer.
 */
function groupColumns(): DataTableColumn<GroupSummary>[] {
  return [
    {
      key: 'name',
      header: 'Group',
      className: 'font-medium',
      // Members are the student list filtered — the same screen, not a copy.
      cell: (group) => (
        <Link to={`${ROUTES.STUDENTS}?groupId=${group.id}`} className={linkVariants()}>
          {group.name}
        </Link>
      ),
    },
    {
      key: 'branch',
      header: 'Branch',
      cell: (group) =>
        group.branch.isGlobal ? (
          <Badge variant="info">{group.branch.name}</Badge>
        ) : (
          <span className="text-muted-foreground">{group.branch.name}</span>
        ),
    },
    { key: 'students', header: 'Students', numeric: true, cell: (g) => g.studentCount },
    { key: 'series', header: 'Test series', numeric: true, cell: (g) => g.testSeriesCount },
    {
      key: 'actions',
      className: 'text-right',
      cell: (group) => <GroupActions group={group} />,
    },
  ];
}

export function GroupsPage() {
  const { can } = useAuth();
  const canWrite = can(FEATURE_KEYS.STUDENT_MANAGEMENT, PERMISSION_LEVELS.WRITE);
  const [creating, setCreating] = useState(false);

  // In the URL, not in state: this is where the Branches page lands.
  const filters = useFilters<'q' | 'branchId'>();
  const search = filters.get('q');
  const branchId = filters.get('branchId');
  const queryClient = useQueryClient();

  // The page resets itself whenever these change — see useListQuery.
  const groups = useListQuery({
    queryKey: ['admin', 'groups'],
    filters: { q: search, branchId: branchId || undefined },
    fetchPage: (params) => api.admin.groups.list(params),
  });

  const allBranches = useBranches();
  const branch = allBranches.find((candidate) => candidate.id === branchId);

  const columns = useMemo(() => groupColumns(), []);

  return (
    <>
      <PageHeader
        title="Groups"
        description="The unit that grants access: a student reaches a test through the group they are in."
        action={
          // WRITE only. The endpoint enforces it either way; this is about not
          // offering a control that would be refused.
          canWrite ? (
            <Button size="sm" onClick={() => setCreating((open) => !open)}>
              <Plus aria-hidden />
              New group
            </Button>
          ) : undefined
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
        {/* Arrived from a branch: say so, and offer the way back out. */}
        {branch ? (
          <div className="mb-4 flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Showing the branch</span>
            <Badge variant={branch.isGlobal ? 'info' : 'primary'}>{branch.name}</Badge>
            <Button variant="ghost" size="sm" onClick={() => filters.set({ branchId: undefined })}>
              <X aria-hidden />
              Clear
            </Button>
          </div>
        ) : null}

        <div className="mb-4 flex flex-wrap gap-3">
          <div className="min-w-56 flex-1">
            <SearchInput
              aria-label="Search groups"
              placeholder="Search by name or branch"
              value={search}
              onChange={(q) => filters.set({ q })}
            />
          </div>
          <div className="w-52">
            <Select
              aria-label="Filter by branch"
              value={branchId}
              onChange={(event) => filters.set({ branchId: event.target.value })}
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

        <DataTable
          columns={columns}
          rows={groups.items}
          rowKey={(group) => group.id}
          isLoading={groups.isLoading}
          empty={
            search
              ? `No group matches “${search}”.`
              : 'No groups yet. Create one before adding students.'
          }
          footer={groups.hasLoaded ? <Pagination {...groups.pagination} /> : null}
        />
      </Card>
    </>
  );
}

// ---------------------------------------------------------------------------

function NewGroupCard({
  onDone,
  onCancel,
}: Readonly<{ onDone: () => void; onCancel: () => void }>) {
  const form = useForm<CreateGroupInput>({
    resolver: zodResolver(createGroupSchema),
    defaultValues: { name: '', branchId: '' },
  });

  // Only ACTIVE branches: a closed centre stays in the list for the groups that
  // already reference it, but nothing new is created under one.
  const branches = useBranches({ activeOnly: true });

  const create = useMutation({
    meta: { success: 'Group created.', fields: NEW_GROUP_FIELDS },
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
        <FormRow onSubmit={form.handleSubmit((values) => create.mutate(values))}>
          <FormField
            form={form}
            name="branchId"
            label="Branch"
            hint="Only a super admin can add a branch."
            className="min-w-48 flex-1"
          >
            {(control) => (
              <Select {...control} autoFocus>
                <option value="">Pick a branch…</option>
                {branches.map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {branch.name}
                  </option>
                ))}
              </Select>
            )}
          </FormField>

          <FormField form={form} name="name" label="Group name" className="min-w-56 flex-1">
            {(control) => (
              // Shown in capitals as it is typed, because that is what will be
              // stored — the preview would otherwise disagree with the result.
              <Input
                {...control}
                className="uppercase placeholder:normal-case"
                placeholder="SSC CGL MORNING"
              />
            )}
          </FormField>

          <FormActions>
            <Button type="submit" loading={create.isPending}>
              Create
            </Button>
            {/* Cancel is neutral grey, never red — it destroys nothing. */}
            <Button type="button" variant="secondary" onClick={onCancel}>
              Cancel
            </Button>
          </FormActions>
        </FormRow>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------

function GroupActions({ group }: Readonly<{ group: GroupSummary }>) {
  const [confirming, setConfirming] = useState(false);
  const queryClient = useQueryClient();

  const remove = useMutation({
    meta: { success: `${group.name} deleted.` },
    mutationFn: () => api.admin.groups.remove(group.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'groups'] }),
    // Drop out of the confirm on failure, or the row is left asking a question
    // that has already been answered.
    onError: () => setConfirming(false),
  });

  if (confirming) {
    return (
      <span className="inline-flex items-center gap-2">
        <span className="text-xs text-muted-foreground">Delete?</span>
        <Button
          size="sm"
          variant="destructive"
          loading={remove.isPending}
          onClick={() => remove.mutate()}
        >
          Yes, delete
        </Button>
        <Button size="sm" variant="secondary" onClick={() => setConfirming(false)}>
          Cancel
        </Button>
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1">
      {/* Bulk membership lives on the group, not on a sheet: the group is the
          screen you are already on, so it cannot be mistyped. */}
      <Button size="sm" variant="outline" asChild>
        <Link to={ROUTES.IMPORT_GROUP_MEMBERS(group.id)}>
          <UserPlus aria-hidden />
          Add students
        </Link>
      </Button>
      <Button
        size="sm"
        variant="ghost"
        aria-label={`Delete ${group.name}`}
        onClick={() => {
          // Clear the last refusal: it described the group as it was before the
          // admin went and moved the students.
          remove.reset();
          setConfirming(true);
        }}
      >
        <Trash2 aria-hidden />
      </Button>
    </span>
  );
}
