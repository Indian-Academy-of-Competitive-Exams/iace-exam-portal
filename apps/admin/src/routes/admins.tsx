import { useCallback, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm, useWatch } from 'react-hook-form';
import { Loader2, Plus, ShieldCheck, UserMinus } from 'lucide-react';
import {
  createAdminSchema,
  PAGE_SIZE_OPTIONS,
  type Admin,
  type CreateAdminInput,
} from '@iace/contracts';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Checkbox,
  DataTable,
  FormActions,
  FormField,
  FormRow,
  Input,
  PageHeader,
  Pagination,
  type DataTableColumn,
} from '@iace/ui';
import { applyFieldErrors, usePageSize } from '@iace/app-kit';
import { api } from '../lib/api';
import { ADMINS_QUERY_KEY } from '../lib/constants';
import { SuperAdminOnly } from '../components/super-admin-only';

const NEW_ADMIN_FIELDS = ['email', 'fullName', 'isSuperAdmin'] as const;

/**
 * Who can get into the admin app, and who is a super admin.
 *
 * Super admin only, and deliberately so: this is the screen that decides who
 * decides. Gating it on a feature permission would let the permission system be
 * used to hand out control of itself.
 *
 * There is no delete. An admin id is referenced by `createdById` on everything
 * they made, so the row has to survive; deactivating is what actually stops
 * them signing in, and it prunes their grants on the way out.
 */
export function AdminsPage() {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = usePageSize();
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);

  const admins = useQuery({
    queryKey: [...ADMINS_QUERY_KEY, page, pageSize],
    queryFn: () => api.admin.admins.list({ page, pageSize }),
  });

  const refresh = useCallback(
    () => void queryClient.invalidateQueries({ queryKey: ADMINS_QUERY_KEY }),
    [queryClient],
  );

  const columns = useMemo<DataTableColumn<Admin>[]>(
    () => [
      { key: 'email', header: 'Email', className: 'font-medium', cell: (a) => a.email },
      { key: 'name', header: 'Name', cell: (a) => a.fullName ?? '—' },
      {
        key: 'role',
        header: 'Role',
        cell: (a) =>
          a.isSuperAdmin ? (
            <Badge variant="primary">
              <ShieldCheck aria-hidden />
              Super admin
            </Badge>
          ) : (
            <Badge variant="neutral">Admin</Badge>
          ),
      },
      {
        key: 'grants',
        header: 'Granted',
        cell: (a) => <GrantSummary admin={a} />,
      },
      {
        key: 'status',
        header: 'Status',
        cell: (a) =>
          a.isActive ? (
            <Badge variant="success">Active</Badge>
          ) : (
            <Badge variant="neutral">Deactivated</Badge>
          ),
      },
      {
        key: 'actions',
        className: 'text-right',
        cell: (a) => <DeactivateButton admin={a} onChanged={refresh} />,
      },
    ],
    [refresh],
  );

  return (
    <SuperAdminOnly title="Admins">
      <PageHeader
        title="Admins"
        description="Who can sign in to this app. Every admin here was created by a super admin — nobody can self-register."
        action={
          <Button size="sm" onClick={() => setCreating((open) => !open)}>
            <Plus aria-hidden />
            New admin
          </Button>
        }
      />

      {creating ? (
        <NewAdminCard
          onDone={() => {
            setCreating(false);
            refresh();
          }}
          onCancel={() => setCreating(false)}
        />
      ) : null}

      <Card className="p-4">
        <DataTable
          columns={columns}
          rows={admins.data?.items ?? []}
          rowKey={(a) => a.id}
          isLoading={admins.isPending}
          empty="No admins yet."
        />
        <Pagination
          page={page}
          pageSize={pageSize}
          total={admins.data?.total ?? 0}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
          pageSizeOptions={PAGE_SIZE_OPTIONS}
        />
      </Card>
    </SuperAdminOnly>
  );
}

// ---------------------------------------------------------------------------

/** A super admin holds everything by bypass, which is a different fact from
 *  holding grants — saying "all" avoids implying they were granted. */
function GrantSummary({ admin }: Readonly<{ admin: Admin }>) {
  if (admin.isSuperAdmin) {
    return <span className="text-sm text-muted-foreground">Everything (bypass)</span>;
  }

  // The admin's OWN keys, not the code's list: a super admin may have
  // registered a sector no controller checks yet, and a grant on it is real.
  const held = Object.keys(admin.permissions).sort();
  if (held.length === 0) {
    return <span className="text-sm text-muted-foreground">Nothing yet</span>;
  }

  return (
    <div className="flex flex-wrap gap-1">
      {held.map((key) => (
        <Badge key={key} variant="neutral">
          {key}
          <span className="opacity-70">{admin.permissions[key]}</span>
        </Badge>
      ))}
    </div>
  );
}

function DeactivateButton({ admin, onChanged }: Readonly<{ admin: Admin; onChanged: () => void }>) {
  const deactivate = useMutation({
    meta: { success: 'Admin deactivated. Their grants were removed.' },
    mutationFn: () => api.admin.admins.deactivate(admin.id),
    onSuccess: onChanged,
  });

  if (!admin.isActive) return null;

  return (
    <Button
      variant="destructive"
      size="sm"
      disabled={deactivate.isPending}
      onClick={() => {
        // A confirm, because it signs somebody out and drops every grant they
        // hold — and re-granting them is manual work for whoever did it.
        if (!globalThis.confirm(`Deactivate ${admin.email}? Their grants will be removed.`)) return;
        deactivate.mutate();
      }}
    >
      {deactivate.isPending ? (
        <Loader2 className="animate-spin" aria-hidden />
      ) : (
        <UserMinus aria-hidden />
      )}
      Deactivate
    </Button>
  );
}

function NewAdminCard({
  onDone,
  onCancel,
}: Readonly<{ onDone: () => void; onCancel: () => void }>) {
  const form = useForm<CreateAdminInput>({
    resolver: zodResolver(createAdminSchema),
    defaultValues: { email: '', fullName: '', isSuperAdmin: false },
  });

  // useWatch, not form.watch: the latter returns a fresh function each render,
  // which makes React Compiler skip memoising the whole component (see the
  // same call in students.tsx).
  const isSuperAdmin = useWatch({ control: form.control, name: 'isSuperAdmin' }) ?? false;

  const create = useMutation({
    meta: { success: 'Admin created.', fields: NEW_ADMIN_FIELDS },
    mutationFn: (values: CreateAdminInput) => api.admin.admins.create(values),
    onSuccess: onDone,
    onError: (error) => applyFieldErrors(error, form.setError, NEW_ADMIN_FIELDS),
  });

  return (
    <Card className="mb-5">
      <CardHeader>
        <CardTitle>New admin</CardTitle>
        <CardDescription>
          They sign in with this email and a one-time code. A new admin holds nothing until you
          grant them something on the Permissions screen.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <FormRow onSubmit={form.handleSubmit((values) => create.mutate(values))}>
          <FormField form={form} name="email" label="Email" className="min-w-64 flex-1">
            {(control) => (
              <Input {...control} type="email" placeholder="name@iace.co.in" autoFocus />
            )}
          </FormField>

          <FormField form={form} name="fullName" label="Name" className="min-w-48 flex-1">
            {(control) => <Input {...control} placeholder="Full name" />}
          </FormField>

          <FormField form={form} name="isSuperAdmin" label="">
            {(control) => (
              <Checkbox
                {...control}
                checked={isSuperAdmin}
                onChange={(event) => form.setValue('isSuperAdmin', event.target.checked)}
                label="Super admin"
                hint="Bypasses every feature check, and can manage admins."
              />
            )}
          </FormField>

          <FormActions>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
              Create
            </Button>
            <Button type="button" variant="secondary" onClick={onCancel}>
              Cancel
            </Button>
          </FormActions>
        </FormRow>
      </CardContent>
    </Card>
  );
}
