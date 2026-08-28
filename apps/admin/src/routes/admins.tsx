import { useCallback, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm, useWatch } from 'react-hook-form';
import { Plus, ShieldCheck, UserCheck, UserMinus } from 'lucide-react';
import {
  createAdminSchema,
  type Admin,
  type CreateAdminInput,
  type FeatureKey,
} from '@iace/contracts';
import {
  Badge,
  BadgeList,
  Button,
  Checkbox,
  ConfirmDialog,
  DropdownMenuItem,
  FormDialog,
  FormField,
  Input,
  ListView,
  PageHeader,
  RowActions,
  TableFrame,
  TruncatedText,
  type DataTableColumn,
} from '@iace/ui';
import { applyFieldErrors } from '@iace/app-kit';
import { PageCrumbs, useListScreen } from '@iace/app-kit/browser';
import { api } from '../lib/api';
import { NAV_ITEMS, QUERY_KEYS } from '../lib/constants';
import { SuperAdminOnly } from '../components/super-admin-only';

const NEW_ADMIN_FIELDS = ['email', 'fullName', 'isSuperAdmin'] as const;

/**
 * Who can get into the admin app. Super admin only — this screen decides who decides.
 * No delete: `createdById` references the row, so deactivating is what stops a sign-in.
 */
/** Built outside the component: `cell` is a render prop, not a component declaration. */
function adminColumns(refresh: () => void): DataTableColumn<Admin>[] {
  return [
    {
      key: 'email',
      header: 'Email',
      className: 'max-w-[18rem] font-medium',
      cell: (a) => <TruncatedText>{a.email}</TruncatedText>,
    },
    {
      key: 'name',
      header: 'Name',
      className: 'max-w-[14rem]',
      cell: (a) => <TruncatedText>{a.fullName}</TruncatedText>,
    },
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
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);

  const admins = useListScreen({
    queryKey: QUERY_KEYS.ADMINS,
    filters: [],
    toQuery: () => ({}),
    fetchPage: (params) => api.admin.admins.list(params),
  });

  const refresh = useCallback(
    () => void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.ADMINS }),
    [queryClient],
  );

  const columns = useMemo(() => adminColumns(refresh), [refresh]);

  const header = (
    <PageHeader
      breadcrumbs={<PageCrumbs nav={NAV_ITEMS} />}
      title="Admins"
      action={
        <Button size="sm" onClick={() => setCreating(true)}>
          <Plus aria-hidden />
          New admin
        </Button>
      }
    />
  );

  return (
    <SuperAdminOnly title="Admins">
      <TableFrame header={header}>
        {/* Portalled, so where it sits in the tree costs the pinned header nothing. */}
        <NewAdminDialog
          open={creating}
          onOpenChange={setCreating}
          onDone={() => {
            setCreating(false);
            refresh();
          }}
        />
        <ListView list={admins} columns={columns} rowKey={(a) => a.id} empty="No admins yet." />
      </TableFrame>
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

  // The admin's own keys, not the code's list. localeCompare, not the UTF-16 default.
  const held = (Object.keys(admin.permissions) as FeatureKey[]).sort((a, b) => a.localeCompare(b));
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

/** Switch an account off, or back on — one control, because it is one decision. */
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
      <RowActions label={`Actions for ${admin.email}`}>
        <DropdownMenuItem
          destructive={admin.isActive}
          disabled={busy}
          onSelect={() => setConfirming(true)}
        >
          {admin.isActive ? <UserMinus aria-hidden /> : <UserCheck aria-hidden />}
          {admin.isActive ? 'Deactivate' : 'Reactivate'}
        </DropdownMenuItem>
      </RowActions>

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

function NewAdminDialog({
  open,
  onOpenChange,
  onDone,
}: Readonly<{ open: boolean; onOpenChange: (open: boolean) => void; onDone: () => void }>) {
  const form = useForm<CreateAdminInput>({
    resolver: zodResolver(createAdminSchema),
    defaultValues: { email: '', fullName: '', isSuperAdmin: false },
  });

  // useWatch, not form.watch: a fresh function each render stops React Compiler memoising.
  const isSuperAdmin = useWatch({ control: form.control, name: 'isSuperAdmin' }) ?? false;

  /** Held between "submit" and "yes" — the form has already validated. */
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
    <>
      <FormDialog
        open={open}
        onOpenChange={onOpenChange}
        form={form}
        onSubmit={setPending}
        title="New admin"
        submitLabel="Create"
        loading={create.isPending}
      >
        <FormField form={form} name="email" label="Email">
          {(control) => <Input {...control} type="email" placeholder="name@iace.co.in" autoFocus />}
        </FormField>

        <FormField form={form} name="fullName" label="Name">
          {(control) => <Input {...control} placeholder="Full name" />}
        </FormField>

        <FormField form={form} name="isSuperAdmin" label="">
          {(control) => (
            <Checkbox
              {...control}
              checked={isSuperAdmin}
              onChange={(event) => form.setValue('isSuperAdmin', event.target.checked)}
              label="Super admin"
              /* ui-copy-ok: consequence */ hint="Bypasses every feature check, and can manage admins."
            />
          )}
        </FormField>
      </FormDialog>

      {/* Creating an admin is creating a way into this app, and a super admin
          bypasses every permission check there is — including the one on this
          screen, so the new account can create more of itself. That is worth
          one deliberate step, and the wording changes with the box, because
          the two outcomes are not the same size. Stacked OVER the form, and
          closing it drops back to the fields with their errors showing. */}
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
    </>
  );
}
