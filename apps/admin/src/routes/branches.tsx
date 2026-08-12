import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { Loader2, Plus, Power, Trash2, Users } from 'lucide-react';
import { createBranchSchema, type Branch, type CreateBranchInput } from '@iace/contracts';
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
import { useAuth } from '../providers/auth-context';
import { api } from '../lib/api';
import { ROUTES } from '../lib/constants';
import { useBranches } from '../lib/use-branches';
import { applyFieldErrors, bannerMessage } from '@iace/app-kit';

const NEW_BRANCH_FIELDS = ['name'] as const;

/**
 * The branch list — deliberately the smallest screen in the app.
 *
 * Everyone who can manage groups can READ it, because they have to pick from it
 * when creating one. Only a super admin can change it, which is the entire
 * reason branches stopped being a free-text field: an admin creating a group
 * should choose from the centres that exist, not name one and hope it matches.
 */
export function BranchesPage() {
  const { admin } = useAuth();
  const isSuperAdmin = admin?.isSuperAdmin ?? false;

  const [creating, setCreating] = useState(false);
  const branches = useBranches();
  const queryClient = useQueryClient();

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['admin', 'branches'] });

  return (
    <>
      <PageHeader
        title="Branches"
        description="The fixed list every group is created under. GLOBAL is for groups that belong to no centre."
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
            void refresh();
          }}
          onCancel={() => setCreating(false)}
        />
      ) : null}

      <Card className="p-4">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Branch</TableHead>
              <TableHead numeric>Groups</TableHead>
              <TableHead />
              <TableHead>Status</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {branches.length === 0 ? (
              <TableEmpty colSpan={5}>No branches yet.</TableEmpty>
            ) : (
              branches.map((branch) => (
                <BranchRow
                  key={branch.id}
                  branch={branch}
                  canEdit={isSuperAdmin}
                  onChanged={refresh}
                />
              ))
            )}
          </TableBody>
        </Table>
      </Card>
    </>
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
        <form
          className="flex flex-wrap items-start gap-4"
          onSubmit={form.handleSubmit((values) => create.mutate(values))}
          noValidate
        >
          <div className="min-w-56 flex-1">
            <Field htmlFor="name" label="Branch name" error={form.formState.errors.name?.message}>
              {(control) => (
                <Input
                  {...control}
                  {...form.register('name')}
                  className="uppercase placeholder:normal-case"
                  placeholder="AMEERPET"
                  autoFocus
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
              <Alert variant="danger">{bannerMessage(create.error, NEW_BRANCH_FIELDS)}</Alert>
            </div>
          ) : null}
        </form>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------

/**
 * What a row lets you do: nothing, confirm a delete, or the ordinary actions.
 *
 * A component rather than a conditional chain because the first state is
 * "render nothing" — flattening that into a ternary once put the Retire and
 * Delete buttons in front of admins who are not allowed to press them.
 */
function BranchActions({
  branch,
  canEdit,
  busy,
  confirming,
  onConfirm,
  onCancel,
  onDelete,
  onToggleActive,
}: Readonly<{
  branch: Branch;
  canEdit: boolean;
  busy: boolean;
  confirming: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  onDelete: () => void;
  onToggleActive: () => void;
}>) {
  // GLOBAL is never editable, whoever is looking.
  if (!canEdit || branch.isGlobal) return null;

  if (confirming) {
    return (
      <span className="inline-flex items-center gap-2">
        <span className="text-xs text-muted-foreground">Delete?</span>
        <Button size="sm" variant="destructive" disabled={busy} onClick={onDelete}>
          Yes, delete
        </Button>
        <Button size="sm" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-2">
      <Button size="sm" variant="outline" disabled={busy} onClick={onToggleActive}>
        <Power aria-hidden />
        {branch.isActive ? 'Retire' : 'Reactivate'}
      </Button>
      {/* Deleting is refused server-side while any group still sits here. */}
      <Button size="sm" variant="ghost" disabled={busy} onClick={onConfirm}>
        <Trash2 aria-hidden />
        Delete
      </Button>
    </span>
  );
}

/** Three states, listed. See SignInStatus in students.tsx for the reasoning. */
function BranchStatus({ branch }: Readonly<{ branch: Branch }>) {
  if (branch.isGlobal) return <Badge variant="info">System</Badge>;
  if (branch.isActive) return <Badge variant="success">Active</Badge>;
  return <Badge variant="neutral">Retired</Badge>;
}

function BranchRow({
  branch,
  canEdit,
  onChanged,
}: Readonly<{
  branch: Branch;
  canEdit: boolean;
  onChanged: () => void;
}>) {
  const [confirming, setConfirming] = useState(false);

  const remove = useMutation({
    mutationFn: () => api.admin.branches.remove(branch.id),
    onSuccess: onChanged,
    // Drop out of the confirm on failure, or the row is left asking a question
    // that has already been answered.
    onError: () => setConfirming(false),
  });

  const setActive = useMutation({
    mutationFn: (isActive: boolean) => api.admin.branches.update(branch.id, { isActive }),
    onSuccess: onChanged,
  });

  const busy = remove.isPending || setActive.isPending;
  const error = remove.error ?? setActive.error;

  return (
    <>
      <TableRow>
        <TableCell className="font-medium">
          {branch.groupCount > 0 ? (
            <Link to={`${ROUTES.GROUPS}?branchId=${branch.id}`} className={linkVariants()}>
              {branch.name}
            </Link>
          ) : (
            branch.name
          )}
        </TableCell>

        <TableCell numeric>
          {branch.groupCount > 0 ? (
            <Link to={`${ROUTES.GROUPS}?branchId=${branch.id}`} className={linkVariants()}>
              {branch.groupCount}
            </Link>
          ) : (
            <span className="text-muted-foreground">0</span>
          )}
        </TableCell>

        <TableCell>
          {/* A branch answers two questions — which groups, and which students
              those groups reach. Both are the existing screen filtered. */}
          <Button variant="ghost" size="sm" asChild>
            <Link to={`${ROUTES.STUDENTS}?branchId=${branch.id}`}>
              <Users aria-hidden />
              Students
            </Link>
          </Button>
        </TableCell>

        <TableCell>
          <BranchStatus branch={branch} />
        </TableCell>

        <TableCell className="text-right">
          <BranchActions
            branch={branch}
            canEdit={canEdit}
            busy={busy}
            confirming={confirming}
            onConfirm={() => setConfirming(true)}
            onCancel={() => setConfirming(false)}
            onDelete={() => remove.mutate()}
            onToggleActive={() => setActive.mutate(!branch.isActive)}
          />
        </TableCell>
      </TableRow>

      {error ? (
        <TableRow>
          <TableCell colSpan={5}>
            <Alert variant="danger">{bannerMessage(error)}</Alert>
          </TableCell>
        </TableRow>
      ) : null}
    </>
  );
}
