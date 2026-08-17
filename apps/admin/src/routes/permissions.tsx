import { useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ShieldCheck } from 'lucide-react';
import { PERMISSION_LEVELS, type Admin, type Feature, type PermissionLevel } from '@iace/contracts';
import { Accordion, Alert, Badge, Card, Checkbox, PageHeader, Spinner } from '@iace/ui';
import { api } from '../lib/api';
import { ADMINS_QUERY_KEY, FEATURES_QUERY_KEY, PAGE_SIZE_FOR_PICKERS } from '../lib/constants';
import { SuperAdminOnly } from '../components/super-admin-only';

/**
 * Who holds what, one admin at a time.
 *
 * By admin rather than by feature, because granting is something you do TO a
 * person: someone has just been created, or has changed job, and the question
 * is "what should they have" — all of it at once, rather than one feature at a
 * time with the rest out of sight.
 *
 * Every panel starts open. The list is short, and a screen whose content sits
 * behind N clicks is one you can neither scan nor find-in-page.
 */
export function PermissionsPage() {
  const queryClient = useQueryClient();

  const features = useQuery({
    queryKey: FEATURES_QUERY_KEY,
    queryFn: () => api.admin.features.list(),
  });
  const admins = useQuery({
    queryKey: [...ADMINS_QUERY_KEY, 'all'],
    queryFn: () =>
      api.admin.admins.list({ page: 1, pageSize: PAGE_SIZE_FOR_PICKERS, activeOnly: 'true' }),
  });

  /**
   * Both caches. A grant changes the feature's holder list AND the admin's
   * permission map, and the checkboxes render off the second — invalidating
   * only one leaves them showing the state from before the click.
   */
  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: FEATURES_QUERY_KEY });
    void queryClient.invalidateQueries({ queryKey: ADMINS_QUERY_KEY });
  }, [queryClient]);

  const registered = features.data ?? [];
  const rows = admins.data?.items ?? [];
  const isLoading = features.isPending || admins.isPending;

  return (
    <SuperAdminOnly title="Permissions">
      <PageHeader
        title="Permissions"
        description="What each admin may do. Write covers create, update and delete, and always includes read."
      />

      {!isLoading && registered.length === 0 ? (
        <Alert variant="warning" className="mb-5">
          <span>
            No features are registered, so there is nothing to grant. Register one on the Features
            screen first.
          </span>
        </Alert>
      ) : null}

      {isLoading ? <Card className="p-4 text-sm text-muted-foreground">Loading…</Card> : null}

      <div className="flex flex-col gap-3">
        {rows.map((admin) => (
          <AdminPanel key={admin.id} admin={admin} features={registered} onChanged={refresh} />
        ))}
      </div>

      {!isLoading && rows.length === 0 ? (
        <Card className="p-4 text-sm text-muted-foreground">No active admins.</Card>
      ) : null}
    </SuperAdminOnly>
  );
}

// ---------------------------------------------------------------------------

function AdminPanel({
  admin,
  features,
  onChanged,
}: Readonly<{ admin: Admin; features: readonly Feature[]; onChanged: () => void }>) {
  const heldCount = features.filter((f) => admin.permissions[f.key] !== undefined).length;

  return (
    <Accordion
      defaultOpen
      title={
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="font-medium text-foreground">{admin.email}</span>
          {admin.fullName ? (
            <span className="text-sm text-muted-foreground">{admin.fullName}</span>
          ) : null}
        </div>
      }
      meta={
        admin.isSuperAdmin ? (
          <Badge variant="primary">
            <ShieldCheck aria-hidden />
            Super admin
          </Badge>
        ) : (
          <Badge variant="neutral">
            <span className="tabular-nums">{heldCount}</span> of {features.length}
          </Badge>
        )
      }
    >
      {admin.isSuperAdmin ? (
        // No checkboxes. A super admin bypasses every check, so a grant would be
        // a row that changes nothing — rendering the controls would imply that
        // ticking them mattered.
        <p className="text-sm text-muted-foreground">
          Bypasses every feature check, so there is nothing to grant. Remove super admin on the
          Admins screen to give them specific access instead.
        </p>
      ) : (
        <FeatureGrid admin={admin} features={features} onChanged={onChanged} />
      )}
    </Accordion>
  );
}

function FeatureGrid({
  admin,
  features,
  onChanged,
}: Readonly<{ admin: Admin; features: readonly Feature[]; onChanged: () => void }>) {
  if (features.length === 0) {
    return <p className="text-sm text-muted-foreground">No features registered yet.</p>;
  }

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-2 border-b border-border pb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <span className="flex-1">Feature</span>
        <span className="w-20 text-center">Read</span>
        <span className="w-20 text-center">Write</span>
      </div>
      {features.map((feature) => (
        <FeatureRow key={feature.id} admin={admin} feature={feature} onChanged={onChanged} />
      ))}
    </div>
  );
}

function FeatureRow({
  admin,
  feature,
  onChanged,
}: Readonly<{ admin: Admin; feature: Feature; onChanged: () => void }>) {
  const held = admin.permissions[feature.key];
  const hasWrite = held === PERMISSION_LEVELS.WRITE;
  /**
   * Write implies read, so read is ticked and locked whenever write is held.
   * The tick is a consequence rather than a choice, and leaving it clickable
   * would offer "write but not read" — a state the server cannot represent.
   */
  const hasRead = held !== undefined;

  const change = useMutation({
    meta: { success: 'Access updated.' },
    /**
     * `next` is the level the admin should end up holding, or null for none.
     *
     * Whatever is held now is revoked first, so both levels can never be set at
     * once. The server resolves that case to WRITE anyway, but a row saying one
     * thing while the screen says another is its own bug.
     */
    mutationFn: async (next: PermissionLevel | null) => {
      if (held) {
        await api.admin.features.revoke({
          featureKey: feature.key,
          level: held,
          adminId: admin.id,
        });
      }
      if (next) {
        await api.admin.features.grant({
          featureKey: feature.key,
          level: next,
          adminId: admin.id,
        });
      }
    },
    onSuccess: onChanged,
  });

  const busy = change.isPending;

  return (
    <div className="flex items-center gap-2 border-b border-border py-1 last:border-b-0">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <code className="truncate">{feature.key}</code>
        {busy ? <Spinner size="sm" /> : null}
      </div>

      <div className="flex w-20 justify-center">
        <Checkbox
          checked={hasRead}
          disabled={busy || hasWrite}
          aria-label={`Read access to ${feature.key} for ${admin.email}`}
          onChange={(event) => change.mutate(event.target.checked ? PERMISSION_LEVELS.READ : null)}
        />
      </div>

      <div className="flex w-20 justify-center">
        <Checkbox
          checked={hasWrite}
          disabled={busy}
          aria-label={`Write access to ${feature.key} for ${admin.email}`}
          // Un-ticking write removes the grant outright rather than demoting to
          // read: the box you clicked is the thing that goes away, and read is
          // one click back if that is what was meant.
          onChange={(event) => change.mutate(event.target.checked ? PERMISSION_LEVELS.WRITE : null)}
        />
      </div>
    </div>
  );
}
