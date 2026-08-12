import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { Loader2, Plus, Power, Trash2 } from 'lucide-react';
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
} from '@iace/ui';
import { PageHeader } from '../components/app-shell';
import { useAuth } from '../providers/auth-context';
import { api } from '../lib/api';
import { ROUTES } from '../lib/constants';
import { useBranches } from '../lib/use-branches';
import { applyFieldErrors, bannerMessage } from '../lib/form-errors';

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
              <TableHead>Status</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {branches.length === 0 ? (
              <TableEmpty colSpan={4}>No branches yet.</TableEmpty>
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

function NewBranchCard({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
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

function BranchRow({
  branch,
  canEdit,
  onChanged,
}: {
  branch: Branch;
  canEdit: boolean;
  onChanged: () => void;
}) {
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
            <Link
              to={`${ROUTES.GROUPS}?branchId=${branch.id}`}
              className="rounded-sm underline-offset-4 hover:underline focus-visible:outline-none focus-visible:shadow-focus"
            >
              {branch.name}
            </Link>
          ) : (
            branch.name
          )}
        </TableCell>

        <TableCell numeric>{branch.groupCount}</TableCell>

        <TableCell>
          {branch.isGlobal ? (
            <Badge variant="info">System</Badge>
          ) : branch.isActive ? (
            <Badge variant="success">Active</Badge>
          ) : (
            <Badge variant="neutral">Retired</Badge>
          )}
        </TableCell>

        <TableCell className="text-right">
          {!canEdit || branch.isGlobal ? null : confirming ? (
            <span className="inline-flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Delete?</span>
              <Button
                size="sm"
                variant="destructive"
                disabled={busy}
                onClick={() => remove.mutate()}
              >
                Yes, delete
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setConfirming(false)}>
                Cancel
              </Button>
            </span>
          ) : (
            <span className="inline-flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => setActive.mutate(!branch.isActive)}
              >
                <Power aria-hidden />
                {branch.isActive ? 'Retire' : 'Reactivate'}
              </Button>
              {/* Deleting is refused server-side while any group still sits here. */}
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirming(true)}>
                <Trash2 aria-hidden />
                Delete
              </Button>
            </span>
          )}
        </TableCell>
      </TableRow>

      {error ? (
        <TableRow>
          <TableCell colSpan={4}>
            <Alert variant="danger">{bannerMessage(error)}</Alert>
          </TableCell>
        </TableRow>
      ) : null}
    </>
  );
}
