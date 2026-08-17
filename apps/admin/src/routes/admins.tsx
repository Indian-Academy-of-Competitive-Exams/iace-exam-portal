import { useCallback, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm, useWatch } from 'react-hook-form';
import { Plus, ShieldCheck, UserCheck, UserMinus } from 'lucide-react';
import {
  createAdminSchema,
  PAGE_SIZE_OPTIONS,
  type Admin,
  type CreateAdminInput,
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
  Checkbox,
  ConfirmDialog,
  DataTable,
  FormActions,
  FormField,
  FormRow,
  Input,
  PageHeader,
  Pagination,
  TruncatedText,
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
/**
 * The column set, built OUTSIDE the component.
 *
 * `cell` is a render prop — an arrow returning JSX — and a static analyser
 * cannot tell that apart from a component declared inside another component,
 * which is a real bug (a new component type every render, so React remounts
 * the subtree and loses its state). Defining them out here makes the
 * distinction explicit rather than something a reader has to infer.
 */
function adminColumns(refresh: () => void): DataTableColumn<Admin>[] {
  return [
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
      cell: (a) => <ActiveToggle admin={a} onChanged={refresh} />,
    },
  ];
}

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

  const columns = useMemo(() => adminColumns(refresh), [refresh]);

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
  // localeCompare, not bare sort(): the default sorts by UTF-16 code unit,
  // which is only accidentally right for ASCII keys and silently wrong the
  // first time one is not.
  const held = Object.keys(admin.permissions).sort((a, b) => a.localeCompare(b));
  if (held.length === 0) {
    return <span className="text-sm text-muted-foreground">Nothing yet</span>;
  }

  return (
    <BadgeList items={held} label={(key) => `${key} — ${admin.permissions[key]}`} max={1}>
      {(key) => (
        <Badge variant="neutral" className="min-w-0 shrink">
          <TruncatedText>{key}</TruncatedText>
          <span className="shrink-0 opacity-70">{admin.permissions[key]}</span>
        </Badge>
      )}
    </BadgeList>
  );
}

/**
 * Switch an account off, or back on.
 *
 * One control for both, because they are one decision seen from two sides —
 * and an account with no action at all beside it (which is what a deactivated
 * row used to show) reads as permanently stuck rather than as switched off.
 */
function ActiveToggle({ admin, onChanged }: Readonly<{ admin: Admin; onChanged: () => void }>) {
  const [confirming, setConfirming] = useState(false);

  const setActive = useMutation({
    meta: {
      success: admin.isActive
        ? 'Admin deactivated. Their grants were removed.'
        : 'Admin reactivated. Grant them access again on the Permissions screen.',
    },
    mutationFn: () => api.admin.admins.setActive(admin.id, !admin.isActive),
    onSuccess: () => {
      setConfirming(false);
      onChanged();
    },
    onError: () => setConfirming(false),
  });

  const busy = setActive.isPending;

  return (
    <>
      {admin.isActive ? (
        <Button
          variant="destructive"
          size="sm"
          icon={<UserMinus aria-hidden />}
          loading={busy}
          onClick={() => setConfirming(true)}
        >
          Deactivate
        </Button>
      ) : (
        <Button
          variant="outline"
          size="sm"
          icon={<UserCheck aria-hidden />}
          loading={busy}
          onClick={() => setConfirming(true)}
        >
          Reactivate
        </Button>
      )}

      {/* Both directions ask, and the reverse one is not politeness: switching an
          admin back on restores their sign-in and NOT the permissions that were
          dropped when they went off. Whoever reactivates them will otherwise
          watch a colleague sign in to an app that shows them nothing, and go
          looking for a bug. Nowhere else on this screen says it.

          It stays open until the request comes back, so a failure lands on the
          dialog that caused it. */}
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        destructive={admin.isActive}
        loading={busy}
        title={admin.isActive ? `Deactivate ${admin.email}?` : `Reactivate ${admin.email}?`}
        description={
          admin.isActive
            ? 'They are signed out and every permission they hold is removed. Switching them back on does NOT restore those grants — someone has to grant them again, by hand.'
            : 'They can sign in again. Their old permissions were removed when they were deactivated and do NOT come back — grant them what they need on the Permissions screen.'
        }
        confirmLabel={admin.isActive ? 'Deactivate' : 'Reactivate'}
        onConfirm={() => setActive.mutate()}
      />
    </>
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

  /**
   * Held between "submit" and "yes": the form has already validated, and the
   * dialog is the last thing between a typed email and an account that can sign
   * in to this app.
   */
  const [pending, setPending] = useState<CreateAdminInput | null>(null);

  const create = useMutation({
    meta: { success: 'Admin created.', fields: NEW_ADMIN_FIELDS },
    mutationFn: (values: CreateAdminInput) => api.admin.admins.create(values),
    onSuccess: () => {
      setPending(null);
      onDone();
    },
    // Back to the form on a refusal — the message belongs on the field that
    // caused it, and a dialog sitting over that field hides it.
    onError: (error) => {
      setPending(null);
      applyFieldErrors(error, form.setError, NEW_ADMIN_FIELDS);
    },
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
        <FormRow onSubmit={form.handleSubmit(setPending)}>
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
            <Button type="submit" loading={create.isPending}>
              Create
            </Button>
            <Button type="button" variant="secondary" onClick={onCancel}>
              Cancel
            </Button>
          </FormActions>
        </FormRow>

        {/* Creating an admin is creating a way into this app, and a super admin
            bypasses every permission check there is — including the one on this
            screen, so the new account can create more of itself. That is worth
            one deliberate step, and the wording changes with the box, because
            the two outcomes are not the same size. */}
        <ConfirmDialog
          open={pending !== null}
          onOpenChange={(open) => {
            if (!open) setPending(null);
          }}
          destructive={pending?.isSuperAdmin ?? false}
          loading={create.isPending}
          title={
            pending?.isSuperAdmin
              ? 'Create a SUPER admin?'
              : `Create an admin for ${pending?.email ?? ''}?`
          }
          description={
            pending?.isSuperAdmin
              ? `${pending.email} will bypass every feature check, can manage branches, and can create and deactivate other admins — including you. Grant it only to someone who already runs the institute.`
              : 'They will be able to sign in with this email and a one-time code. They hold no permissions until you grant them some on the Permissions screen.'
          }
          confirmLabel={pending?.isSuperAdmin ? 'Create super admin' : 'Create admin'}
          onConfirm={() => pending && create.mutate(pending)}
        />
      </CardContent>
    </Card>
  );
}
