import { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { Plus, Users } from 'lucide-react';
import {
  BRANCH_TYPE,
  BRANCH_TYPES,
  createBranchSchema,
  type Branch,
  type CreateBranchInput,
} from '@iace/contracts';
import {
  FormCombobox,
  Alert,
  Badge,
  Button,
  DataTable,
  DropdownMenuItem,
  DropdownMenuSeparator,
  FormDialog,
  FormField,
  Input,
  linkVariants,
  PageHeader,
  plural,
  TableFrame,
  type DataTableColumn,
} from '@iace/ui';
import { ActiveStatus, RetireDeleteActions } from '../components/retire-delete-actions';
import { useAuth } from '../providers/auth';
import { api } from '../lib/api';
import { BRANCH_TYPE_LABELS, NAV_ITEMS, QUERY_KEYS, ROUTES } from '../lib/constants';
import { useBranches } from '../lib/use-branches';
import { applyFieldErrors } from '@iace/app-kit';
import { PageCrumbs } from '@iace/app-kit/browser';

const NEW_BRANCH_FIELDS = ['name', 'type'] as const;

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
      key: 'status',
      header: 'Status',
      cell: (branch) =>
        branch.type === BRANCH_TYPE.VIRTUAL ? (
          <Badge variant="info">System</Badge>
        ) : (
          <ActiveStatus isActive={branch.isActive} />
        ),
    },
    {
      key: 'actions',
      className: 'text-right',
      cell: (branch) => (
        <BranchRowActions branch={branch} canEdit={isSuperAdmin} onChanged={refresh} />
      ),
    },
  ];
}

function BranchRowActions({
  branch,
  canEdit,
  onChanged,
}: Readonly<{ branch: Branch; canEdit: boolean; onChanged: () => void }>) {
  // The online branch is never editable, so its menu holds only the students link.
  const editable = canEdit && branch.type !== BRANCH_TYPE.VIRTUAL;

  return (
    <RetireDeleteActions
      name={branch.name}
      noun="branch"
      isActive={branch.isActive}
      canEdit={editable}
      resource={api.admin.branches}
      id={branch.id}
      onChanged={onChanged}
      retireText={
        branch.isActive
          ? `Nothing it already holds changes — the ${plural(branch.studentCount, 'student')} who attend it keep working exactly as now. What stops is new ones: this branch will no longer be offered when anyone assigns a student. Reactivating puts it back.`
          : 'The branch is offered again when anyone assigns a student. Nothing else changes.'
      }
      deleteText={
        branch.studentCount === 0
          ? 'No student attends this branch, so nothing loses access. This cannot be undone.'
          : `${plural(branch.studentCount, 'student')} still attend this branch, and deleting it will be refused. Move them to another branch first, or retire this one instead — a retired branch keeps everyone it has and simply takes no new students.`
      }
    >
      <DropdownMenuItem asChild>
        <Link to={`${ROUTES.STUDENTS}?branchId=${branch.id}`}>
          <Users aria-hidden />
          Students
        </Link>
      </DropdownMenuItem>
      {editable ? <DropdownMenuSeparator /> : null}
    </RetireDeleteActions>
  );
}

/** Anyone managing students may read the list, because they pick from it. Only a super admin writes. */
export function BranchesPage() {
  const { identity: admin } = useAuth();
  const isSuperAdmin = admin?.isSuperAdmin ?? false;

  const [creating, setCreating] = useState(false);
  const branches = useBranches();
  const queryClient = useQueryClient();

  const refresh = useCallback(
    () => void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.BRANCHES }),
    [queryClient],
  );

  const columns = useMemo(() => branchColumns(isSuperAdmin, refresh), [isSuperAdmin, refresh]);

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
        empty="No branches yet"
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

      <FormCombobox
        form={form}
        name="type"
        label="Type"
        // Virtual goes once one exists: an option that can only fail is not a choice.
        items={BRANCH_TYPES.filter(
          (value) => value !== BRANCH_TYPE.VIRTUAL || !hasOnlineBranch,
        ).map((value) => ({ value, label: BRANCH_TYPE_LABELS[value] }))}
      />
    </FormDialog>
  );
}
