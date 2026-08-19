import { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Plus, Power, Trash2, UserPlus, X } from 'lucide-react';
import {
  acceptsDirectGrants,
  BRANCH_TYPE,
  CREATABLE_GROUP_TYPES,
  createGroupSchema,
  GROUP_TYPE,
  qualifiedGroupName,
  requiresExamType,
  type BranchRef,
  type CreateGroupInput,
  type GroupSummary,
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
  Combobox,
  ConfirmDialog,
  plural,
  DataTable,
  FormActions,
  FormField,
  FormRow,
  Input,
  linkVariants,
  MultiCombobox,
  PageHeader,
  Pagination,
  SearchInput,
  Select,
  TableFrame,
  type DataTableColumn,
} from '@iace/ui';
import { api } from '../lib/api';
import { useAuth } from '../providers/auth';
import { GROUP_TYPE_LABELS, ROUTES } from '../lib/constants';
import { useBranches } from '../lib/use-branches';
import { useExamTypes } from '../lib/use-exam-types';
import { applyFieldErrors, useListQuery } from '@iace/app-kit';
import { FEATURE_KEYS, PERMISSION_LEVELS } from '@iace/contracts';
import { useFilters } from '../lib/use-filters';

const NEW_GROUP_FIELDS = ['name', 'type', 'examType', 'branchIds'] as const;

/** One question at a time: two booleans could render two dialogs at once. */
const GROUP_CONFIRMS = {
  DELETE: 'delete',
  RETIRE: 'retire',
} as const;
type GroupConfirm = (typeof GROUP_CONFIRMS)[keyof typeof GROUP_CONFIRMS];

/** Built outside the component: `cell` is a render prop, not a component declaration. */
function groupColumns(refresh: () => void): DataTableColumn<GroupSummary>[] {
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
      key: 'type',
      header: 'Type',
      cell: (group) => <Badge variant="neutral">{GROUP_TYPE_LABELS[group.type]}</Badge>,
    },
    {
      key: 'exam',
      header: 'Exam',
      cell: (group) => group.examType ?? <span className="text-muted-foreground">—</span>,
    },
    {
      key: 'branches',
      header: 'Branches',
      cell: (group) => <BranchesCell branches={group.branches} />,
    },
    { key: 'students', header: 'Students', numeric: true, cell: (g) => g.studentCount },
    { key: 'series', header: 'Test series', numeric: true, cell: (g) => g.testSeriesCount },
    { key: 'status', header: 'Status', cell: (group) => <GroupStatus group={group} /> },
    {
      key: 'actions',
      className: 'text-right',
      cell: (group) => <GroupRowActions group={group} onChanged={refresh} />,
    },
  ];
}

/** Three states, listed. See BranchStatus in branches.tsx for the reasoning. */
function GroupStatus({ group }: Readonly<{ group: GroupSummary }>) {
  if (group.type === GROUP_TYPE.GLOBAL) return <Badge variant="info">System</Badge>;
  if (group.isActive) return <Badge variant="success">Active</Badge>;
  return <Badge variant="neutral">Retired</Badge>;
}

/** Every centre a group is offered at: the first, then a focusable count for the rest. */
function BranchesCell({ branches }: Readonly<{ branches: BranchRef[] }>) {
  return (
    <BadgeList
      items={branches}
      label={(branch) => branch.name}
      empty={<span className="text-muted-foreground">None</span>}
    >
      {(branch) => (
        <Badge variant={branch.type === BRANCH_TYPE.VIRTUAL ? 'info' : 'neutral'}>
          {branch.name}
        </Badge>
      )}
    </BadgeList>
  );
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

  const refresh = useCallback(
    () => void queryClient.invalidateQueries({ queryKey: ['admin', 'groups'] }),
    [queryClient],
  );

  const columns = useMemo(() => groupColumns(refresh), [refresh]);

  const header = (
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
    </>
  );

  const toolbar = (
    <>
      {/* Arrived from a branch: say so, and offer the way back out. */}
      {branch ? (
        <div className="mb-4 flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Showing the branch</span>
          <Badge variant={branch.type === BRANCH_TYPE.VIRTUAL ? 'info' : 'primary'}>
            {branch.name}
          </Badge>
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
    </>
  );

  return (
    <TableFrame framed={!creating} header={header} toolbar={toolbar}>
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
    </TableFrame>
  );
}

// ---------------------------------------------------------------------------

function NewGroupCard({
  onDone,
  onCancel,
}: Readonly<{ onDone: () => void; onCancel: () => void }>) {
  const form = useForm<CreateGroupInput>({
    resolver: zodResolver(createGroupSchema),
    defaultValues: { name: '', type: GROUP_TYPE.EXAM, examType: undefined, branchIds: [] },
  });

  const type = useWatch({ control: form.control, name: 'type' });
  const examType = useWatch({ control: form.control, name: 'examType' });
  const branchIds = useWatch({ control: form.control, name: 'branchIds' }) ?? [];
  const reachedByExam = requiresExamType(type);

  // Only ACTIVE ones: a closed centre and a retired exam stay in the list for
  // what already references them, but nothing new is created under one.
  const branches = useBranches({ activeOnly: true });
  const examTypes = useExamTypes({ activeOnly: true });

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
          The type decides who reaches it: an exam group takes everybody enrolled in that exam, a
          scholarship group takes the students you put in it. Names are stored in capitals, so “SSC
          CGL Morning” and “ssc cgl morning” are the same group.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <FormRow onSubmit={form.handleSubmit((values) => create.mutate(values))}>
          <FormField form={form} name="type" label="Type" className="min-w-44 flex-1">
            {(control) => (
              <Select
                {...control}
                autoFocus
                onChange={(event) => {
                  void control.onChange(event);
                  if (!requiresExamType(event.target.value as GroupSummary['type'])) {
                    form.setValue('examType', undefined);
                    form.setValue('branchIds', []);
                  }
                }}
              >
                {CREATABLE_GROUP_TYPES.map((option) => (
                  <option key={option} value={option}>
                    {GROUP_TYPE_LABELS[option]}
                  </option>
                ))}
              </Select>
            )}
          </FormField>

          {reachedByExam ? (
            <FormField
              form={form}
              name="examType"
              label="Exam"
              hint="Students enrolled in this exam reach the group."
              className="min-w-48 flex-1"
            >
              {({ id }) => (
                <Combobox
                  id={id}
                  aria-label="Exam"
                  value={examType ?? ''}
                  onChange={(next) =>
                    form.setValue('examType', next || undefined, { shouldValidate: true })
                  }
                  items={examTypes.map((exam) => ({
                    value: exam.code,
                    label: exam.name,
                    hint: exam.code,
                  }))}
                  placeholder="Pick the exam…"
                  emptyLabel="No active exam type"
                />
              )}
            </FormField>
          ) : null}

          {reachedByExam ? (
            <FormField form={form} name="branchIds" label="Branches" className="min-w-56 flex-1">
              {({ id }) => (
                <MultiCombobox
                  id={id}
                  aria-label="Branches"
                  value={branchIds}
                  onChange={(next) => form.setValue('branchIds', next, { shouldValidate: true })}
                  items={branches.map((branch) => ({ value: branch.id, label: branch.name }))}
                  placeholder="Pick the centres…"
                  emptyLabel="No active branch"
                />
              )}
            </FormField>
          ) : null}

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

/** The buttons only ask; both dialogs live with the mutations in `GroupRowActions`. */
function GroupActions({
  group,
  busy,
  onAsk,
}: Readonly<{ group: GroupSummary; busy: boolean; onAsk: (confirm: GroupConfirm) => void }>) {
  if (group.type === GROUP_TYPE.GLOBAL) return null;

  return (
    <span className="inline-flex items-center gap-1">
      {/* Only the types a grant means anything for. An exam group is reached by
          an enrolment, so there is nobody to add here. */}
      {acceptsDirectGrants(group.type) ? (
        <Button size="sm" variant="outline" asChild>
          <Link to={ROUTES.IMPORT_GROUP_MEMBERS(group.id)}>
            <UserPlus aria-hidden />
            Add students
          </Link>
        </Button>
      ) : null}
      <Button
        size="sm"
        variant="outline"
        disabled={busy}
        onClick={() => onAsk(GROUP_CONFIRMS.RETIRE)}
      >
        <Power aria-hidden />
        {group.isActive ? 'Retire' : 'Reactivate'}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        aria-label={`Delete ${group.name}`}
        disabled={busy}
        onClick={() => onAsk(GROUP_CONFIRMS.DELETE)}
      >
        <Trash2 aria-hidden />
      </Button>
    </span>
  );
}

function GroupRowActions({
  group,
  onChanged,
}: Readonly<{ group: GroupSummary; onChanged: () => void }>) {
  const [asking, setAsking] = useState<GroupConfirm | null>(null);
  const close = () => setAsking(null);

  const remove = useMutation({
    meta: { success: `${group.name} deleted.` },
    mutationFn: () => api.admin.groups.remove(group.id),
    onSuccess: () => {
      close();
      onChanged();
    },
    // Drop out of the confirm on failure, or the row is left asking a question
    // that has already been answered.
    onError: close,
  });

  const setActive = useMutation({
    meta: { success: (): string => `${group.name} updated.` },
    mutationFn: (isActive: boolean) => api.admin.groups.update(group.id, { isActive }),
    onSuccess: () => {
      close();
      onChanged();
    },
    onError: close,
  });

  const busy = remove.isPending || setActive.isPending;

  return (
    <>
      <GroupActions
        group={group}
        busy={busy}
        onAsk={(confirm) => {
          // Clear the last refusal: it described the group as it was before the
          // admin went and moved the students.
          remove.reset();
          setAsking(confirm);
        }}
      />

      {/* Retiring is reversible and still asks: nothing about this row changes
          except a badge, and the consequence lands later on somebody else. */}
      <ConfirmDialog
        open={asking === GROUP_CONFIRMS.RETIRE}
        onOpenChange={close}
        loading={setActive.isPending}
        title={
          group.isActive ? `Retire ${qualifiedGroupName(group)}?` : `Reactivate ${group.name}?`
        }
        description={
          group.isActive
            ? `${plural(group.studentCount, 'student')} keep the access they have. The group takes no new students and stops being offered when a test series is set up.`
            : 'The group is offered again and can take new students.'
        }
        confirmLabel={group.isActive ? 'Retire group' : 'Reactivate group'}
        onConfirm={() => setActive.mutate(!group.isActive)}
      />

      {/* A group is how a student reaches a test, so deleting one takes access
          away from everybody it reaches — the dialog's count says how many. */}
      <ConfirmDialog
        open={asking === GROUP_CONFIRMS.DELETE}
        onOpenChange={close}
        destructive
        loading={remove.isPending}
        title={`Delete ${qualifiedGroupName(group)}?`}
        description={
          group.studentCount === 0
            ? 'The group is empty, so nobody loses access. This cannot be undone.'
            : `${plural(group.studentCount, 'student')} reach their tests through this group and will lose that access. The students themselves are not deleted. This cannot be undone.`
        }
        confirmLabel="Delete group"
        onConfirm={() => remove.mutate()}
      />
    </>
  );
}
