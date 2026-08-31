import { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm, useWatch } from 'react-hook-form';
import { ClipboardList, Plus, Power, Trash2, Users } from 'lucide-react';
import {
  BRANCH_TYPE,
  BRANCH_TYPES,
  createBranchSchema,
  FEATURE_KEYS,
  type Branch,
  type BranchType,
  type CreateBranchInput,
} from '@iace/contracts';
import {
  Alert,
  Badge,
  Button,
  Combobox,
  ConfirmDialog,
  DataTable,
  DropdownMenuItem,
  DropdownMenuSeparator,
  FormDialog,
  FormField,
  Input,
  linkVariants,
  PageHeader,
  plural,
  RowActions,
  TableFrame,
  type DataTableColumn,
} from '@iace/ui';
import { useAuth } from '../providers/auth';
import { api } from '../lib/api';
import { BRANCH_TYPE_LABELS, NAV_ITEMS, QUERY_KEYS, ROUTES } from '../lib/constants';
import { useBranches } from '../lib/use-branches';
import { applyFieldErrors } from '@iace/app-kit';
import { PageCrumbs } from '@iace/app-kit/browser';

const NEW_BRANCH_FIELDS = ['name', 'type'] as const;

/** Built outside the component: `cell` is a render prop, not a component declaration. */
function branchColumns(
  isSuperAdmin: boolean,
  canConfigure: boolean,
  refresh: () => void,
): DataTableColumn<Branch>[] {
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
    { key: 'status', header: 'Status', cell: (branch) => <BranchStatus branch={branch} /> },
    {
      key: 'actions',
      className: 'text-right',
      cell: (branch) => (
        <BranchRowActions
          branch={branch}
          canEdit={isSuperAdmin}
          canConfigure={canConfigure}
          onChanged={refresh}
        />
      ),
    },
  ];
}

/** Anyone managing students may read the list, because they pick from it. Only a super admin writes. */
export function BranchesPage() {
  const { identity: admin, can } = useAuth();
  const isSuperAdmin = admin?.isSuperAdmin ?? false;
  const canConfigure = can(FEATURE_KEYS.BRANCH_TEST_MANAGEMENT);

  const [creating, setCreating] = useState(false);
  const branches = useBranches();
  const queryClient = useQueryClient();

  const refresh = useCallback(
    () => void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.BRANCHES }),
    [queryClient],
  );

  const columns = useMemo(
    () => branchColumns(isSuperAdmin, canConfigure, refresh),
    [isSuperAdmin, canConfigure, refresh],
  );

  const header = (
    <>
      <PageHeader
        breadcrumbs={<PageCrumbs nav={NAV_ITEMS} />}
        title="Branches"
        action={
          isSuperAdmin ? (
            <Button size="sm" onClick={() => setCreating(true)}>
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
    </>
  );

  return (
    <TableFrame header={header}>
      {/* Rendered inside the frame, not the header: a dialog is portalled, so where it
          sits in the tree costs the pinned header nothing. */}
      <NewBranchDialog
        open={creating}
        onOpenChange={setCreating}
        onDone={() => {
          setCreating(false);
          refresh();
        }}
        hasOnlineBranch={branches.some((branch) => branch.type === BRANCH_TYPE.VIRTUAL)}
      />
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

function NewBranchDialog({
  open,
  onOpenChange,
  onDone,
  hasOnlineBranch,
}: Readonly<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
  hasOnlineBranch: boolean;
}>) {
  const form = useForm<CreateBranchInput>({
    resolver: zodResolver(createBranchSchema),
    defaultValues: { name: '', type: BRANCH_TYPE.PHYSICAL },
  });

  const type = useWatch({ control: form.control, name: 'type' }) ?? BRANCH_TYPE.PHYSICAL;

  const create = useMutation({
    meta: { success: 'Branch created.', fields: NEW_BRANCH_FIELDS },
    mutationFn: (values: CreateBranchInput) => api.admin.branches.create(values),
    onSuccess: onDone,
    onError: (error) => applyFieldErrors(error, form.setError, NEW_BRANCH_FIELDS),
  });

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="New branch"
      submitLabel="Create"
      loading={create.isPending}
      form={form}
      onSubmit={(values) => create.mutate(values)}
    >
      <FormField form={form} name="name" label="Branch name">
        {(control) => (
          <Input
            {...control}
            className="uppercase placeholder:normal-case"
            placeholder="AMEERPET"
            autoFocus
          />
        )}
      </FormField>

      <FormField form={form} name="type" label="Type">
        {({ id, 'aria-describedby': describedBy, 'aria-invalid': invalid }) => (
          <Combobox
            id={id}
            aria-describedby={describedBy}
            aria-invalid={invalid}
            clearable={false}
            value={type}
            onChange={(next) => form.setValue('type', next as BranchType, { shouldDirty: true })}
            // Virtual goes once one exists: an option that can only fail is not a choice.
            items={BRANCH_TYPES.filter(
              (value) => value !== BRANCH_TYPE.VIRTUAL || !hasOnlineBranch,
            ).map((value) => ({ value, label: BRANCH_TYPE_LABELS[value] }))}
          />
        )}
      </FormField>
    </FormDialog>
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
  canConfigure,
  busy,
  onAsk,
}: Readonly<{
  branch: Branch;
  canEdit: boolean;
  canConfigure: boolean;
  busy: boolean;
  onAsk: (confirm: BranchConfirm) => void;
}>) {
  // The online branch is never editable, so its menu would hold only the students link.
  const editable = canEdit && branch.type !== BRANCH_TYPE.VIRTUAL;

  return (
    <RowActions label={`Actions for ${branch.name}`}>
      <DropdownMenuItem asChild>
        <Link to={`${ROUTES.STUDENTS}?branchId=${branch.id}`}>
          <Users aria-hidden />
          Students
        </Link>
      </DropdownMenuItem>

      {/* What makes the branch a route rather than a picker: an admin holding several picks one. */}
      {canConfigure ? (
        <DropdownMenuItem asChild>
          <Link to={`${ROUTES.BRANCH_TEST_SERIES}?branchId=${branch.id}`}>
            <ClipboardList aria-hidden />
            Configure tests
          </Link>
        </DropdownMenuItem>
      ) : null}

      {editable ? (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={busy} onSelect={() => onAsk(BRANCH_CONFIRMS.RETIRE)}>
            <Power aria-hidden />
            {branch.isActive ? 'Retire' : 'Reactivate'}
          </DropdownMenuItem>
          <DropdownMenuItem
            destructive
            disabled={busy}
            onSelect={() => onAsk(BRANCH_CONFIRMS.DELETE)}
          >
            <Trash2 aria-hidden />
            Delete
          </DropdownMenuItem>
        </>
      ) : null}
    </RowActions>
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
  canConfigure,
  onChanged,
}: Readonly<{
  branch: Branch;
  canEdit: boolean;
  canConfigure: boolean;
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
      <BranchActions
        branch={branch}
        canEdit={canEdit}
        canConfigure={canConfigure}
        busy={busy}
        onAsk={setAsking}
      />

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
