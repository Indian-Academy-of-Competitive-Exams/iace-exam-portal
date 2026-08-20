import { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { Plus, Power, Trash2, Users } from 'lucide-react';
import {
  BRANCH_TYPE,
  createBranchSchema,
  type Branch,
  type CreateBranchInput,
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
  ConfirmDialog,
  DataTable,
  FormActions,
  FormField,
  FormRow,
  Input,
  linkVariants,
  PageHeader,
  plural,
  TableFrame,
  type DataTableColumn,
} from '@iace/ui';
import { useAuth } from '../providers/auth';
import { api } from '../lib/api';
import { ROUTES } from '../lib/constants';
import { useBranches } from '../lib/use-branches';
import { applyFieldErrors } from '@iace/app-kit';

const NEW_BRANCH_FIELDS = ['name'] as const;

/** Built outside the component: `cell` is a render prop, not a component declaration. */
function branchColumns(isSuperAdmin: boolean, refresh: () => void): DataTableColumn<Branch>[] {
  return [
    {
      key: 'name',
      header: 'Branch',
      className: 'font-medium',
      cell: (branch) =>
        branch.studentCount > 0 ? (
          <Link to={`${ROUTES.STUDENTS}?branchId=${branch.id}`} className={linkVariants()}>
            {branch.name}
          </Link>
        ) : (
          branch.name
        ),
    },
    {
      key: 'students',
      header: 'Students',
      numeric: true,
      cell: (branch) =>
        branch.studentCount > 0 ? (
          <Link to={`${ROUTES.STUDENTS}?branchId=${branch.id}`} className={linkVariants()}>
            {branch.studentCount}
          </Link>
        ) : (
          <span className="text-muted-foreground">0</span>
        ),
    },
    {
      key: 'students',
      // The students screen, filtered — a branch has no roster of its own.
      cell: (branch) => (
        <Button variant="ghost" size="sm" asChild>
          <Link to={`${ROUTES.STUDENTS}?branchId=${branch.id}`}>
            <Users aria-hidden />
            Students
          </Link>
        </Button>
      ),
    },
    { key: 'status', header: 'Status', cell: (branch) => <BranchStatus branch={branch} /> },
    {
      key: 'actions',
      className: 'text-right',
      cell: (branch) => (
        <BranchRowActions branch={branch} canEdit={isSuperAdmin} onChanged={refresh} />
      ),
    },
  ];
}

/** Anyone managing students may read the list, because they pick from it. Only a super admin writes. */
export function BranchesPage() {
  const { identity: admin } = useAuth();
  const isSuperAdmin = admin?.isSuperAdmin ?? false;

  const [creating, setCreating] = useState(false);
  const branches = useBranches();
  const queryClient = useQueryClient();

  const refresh = useCallback(
    () => void queryClient.invalidateQueries({ queryKey: ['admin', 'branches'] }),
    [queryClient],
  );

  const columns = useMemo(() => branchColumns(isSuperAdmin, refresh), [isSuperAdmin, refresh]);

  const header = (
    <>
      <PageHeader
        title="Branches"
        description="The centres the institute teaches at. Every student attends one, and scheduling reads it."
        action={
          isSuperAdmin ? (
            <Button size="sm" onClick={() => setCreating((open) => !open)}>
              <Plus aria-hidden />
              New branch
            </Button>
          ) : undefined
        }
      />

      {!isSuperAdmin ? (
        <Alert variant="info" className="mb-5">
          <span>
            Only a super admin can add or change a branch. You can see the list to pick from.
          </span>
        </Alert>
      ) : null}

      {creating ? (
        <NewBranchCard
          onDone={() => {
            setCreating(false);
            refresh();
          }}
          onCancel={() => setCreating(false)}
        />
      ) : null}
    </>
  );

  return (
    <TableFrame framed={!creating} header={header}>
      {/* No pagination: the branch list is a short, slow-moving one that
          `useBranches` already loads in full, a page at a time. */}
      <DataTable
        columns={columns}
        rows={branches}
        rowKey={(branch) => branch.id}
        isLoading={false}
        empty="No branches yet."
      />
    </TableFrame>
  );
}

// ---------------------------------------------------------------------------

function NewBranchCard({
  onDone,
  onCancel,
}: Readonly<{ onDone: () => void; onCancel: () => void }>) {
  const form = useForm<CreateBranchInput>({
    resolver: zodResolver(createBranchSchema),
    defaultValues: { name: '' },
  });

  const create = useMutation({
    meta: { success: 'Branch created.', fields: NEW_BRANCH_FIELDS },
    mutationFn: (values: CreateBranchInput) => api.admin.branches.create(values),
    onSuccess: onDone,
    onError: (error) => applyFieldErrors(error, form.setError, NEW_BRANCH_FIELDS),
  });

  return (
    <Card className="mb-5">
      <CardHeader>
        <CardTitle>New branch</CardTitle>
        <CardDescription>
          A centre, not a batch. Stored in capitals, so it can only ever be spelled one way.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <FormRow onSubmit={form.handleSubmit((values) => create.mutate(values))}>
          <FormField form={form} name="name" label="Branch name" className="min-w-56 flex-1">
            {(control) => (
              <Input
                {...control}
                className="uppercase placeholder:normal-case"
                placeholder="AMEERPET"
                autoFocus
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

/** One question at a time: two booleans could render two dialogs at once. */
const BRANCH_CONFIRMS = {
  DELETE: 'delete',
  RETIRE: 'retire',
} as const;
type BranchConfirm = (typeof BRANCH_CONFIRMS)[keyof typeof BRANCH_CONFIRMS];

/**
 * The buttons only ask; both dialogs live with the mutations in `BranchRowActions`.
 * A component, not a ternary, because the first state is "render nothing".
 */
function BranchActions({
  branch,
  canEdit,
  busy,
  onAsk,
}: Readonly<{
  branch: Branch;
  canEdit: boolean;
  busy: boolean;
  onAsk: (confirm: BranchConfirm) => void;
}>) {
  // The online branch is never editable, whoever is looking.
  if (!canEdit || branch.type === BRANCH_TYPE.VIRTUAL) return null;

  return (
    <span className="inline-flex items-center gap-2">
      <Button
        size="sm"
        variant="outline"
        disabled={busy}
        onClick={() => onAsk(BRANCH_CONFIRMS.RETIRE)}
      >
        <Power aria-hidden />
        {branch.isActive ? 'Retire' : 'Reactivate'}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        disabled={busy}
        onClick={() => onAsk(BRANCH_CONFIRMS.DELETE)}
      >
        <Trash2 aria-hidden />
        Delete
      </Button>
    </span>
  );
}

/** Three states, listed. See SignInStatus in students.tsx for the reasoning. */
function BranchStatus({ branch }: Readonly<{ branch: Branch }>) {
  if (branch.type === BRANCH_TYPE.VIRTUAL) return <Badge variant="info">System</Badge>;
  if (branch.isActive) return <Badge variant="success">Active</Badge>;
  return <Badge variant="neutral">Retired</Badge>;
}

/** The mutations a row can run, and the question each one asks first. */
function BranchRowActions({
  branch,
  canEdit,
  onChanged,
}: Readonly<{
  branch: Branch;
  canEdit: boolean;
  onChanged: () => void;
}>) {
  const [asking, setAsking] = useState<BranchConfirm | null>(null);
  const close = () => setAsking(null);

  const remove = useMutation({
    meta: { success: `${branch.name} deleted.` },
    mutationFn: () => api.admin.branches.remove(branch.id),
    onSuccess: () => {
      close();
      onChanged();
    },
    // Drop out of the confirm on failure, or the row is left asking a question
    // that has already been answered.
    onError: close,
  });

  const setActive = useMutation({
    meta: { success: (): string => `${branch.name} updated.` },
    mutationFn: (isActive: boolean) => api.admin.branches.update(branch.id, { isActive }),
    onSuccess: () => {
      close();
      onChanged();
    },
    onError: close,
  });

  const busy = remove.isPending || setActive.isPending;

  return (
    <>
      <BranchActions branch={branch} canEdit={canEdit} busy={busy} onAsk={setAsking} />

      {/* Retiring is reversible, and it still asks. It is not the undo that
          makes it worth a question — it is that the effect is invisible from
          here: nothing about this row changes except a badge, and the
          consequence lands weeks later on somebody else, as a branch that is
          not offered when they assign a student. A switch whose result you
          cannot see is exactly the one to state out loud. */}
      <ConfirmDialog
        open={asking === BRANCH_CONFIRMS.RETIRE}
        onOpenChange={(open) => !open && close()}
        loading={setActive.isPending}
        title={branch.isActive ? `Retire ${branch.name}?` : `Reactivate ${branch.name}?`}
        description={
          branch.isActive
            ? `Nothing it already holds changes — the ${plural(branch.studentCount, 'student')} who attend it keep working exactly as now. What stops is new ones: this branch will no longer be offered when anyone assigns a student. Reactivating puts it back.`
            : 'The branch is offered again when anyone assigns a student. Nothing else changes.'
        }
        confirmLabel={branch.isActive ? 'Retire branch' : 'Reactivate branch'}
        onConfirm={() => setActive.mutate(!branch.isActive)}
      />

      {/* Deleting is refused server-side while any student still sits here, so the
          count decides which of two different questions this is: "confirm an
          empty shell goes" or "you are about to be told no". Saying which
          before the click saves a round trip and an error nobody expected. */}
      <ConfirmDialog
        open={asking === BRANCH_CONFIRMS.DELETE}
        onOpenChange={(open) => !open && close()}
        destructive
        loading={remove.isPending}
        title={`Delete ${branch.name}?`}
        description={
          branch.studentCount === 0
            ? 'No student attends this branch, so nothing loses access. This cannot be undone.'
            : `${plural(branch.studentCount, 'student')} still attend this branch, and deleting it will be refused. Move them to another branch first, or retire this one instead — a retired branch keeps everyone it has and simply takes no new students.`
        }
        confirmLabel="Delete branch"
        onConfirm={() => remove.mutate()}
      />
    </>
  );
}
