import { useCallback, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ShieldCheck } from 'lucide-react';
import {
  PERMISSION_LEVELS,
  type Admin,
  type Feature,
  type FeatureKey,
  type PermissionLevel,
} from '@iace/contracts';
import {
  Accordion,
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  ConfirmDialog,
  PageFrame,
  PageHeader,
  plural,
  Skeleton,
  StatRow,
} from '@iace/ui';
import { PageCrumbs } from '@iace/app-kit/browser';
import { api } from '../lib/api';
import { NAV_ITEMS, PAGE_SIZE_FOR_PICKERS, QUERY_KEYS } from '../lib/constants';
import { SuperAdminOnly } from '../components/super-admin-only';

/** What an admin holds for one feature, with "nothing" said out loud. */
type Level = PermissionLevel | null;

/**
 * The edits since the last save. A DIFF, not a copy: an untouched feature reads
 * through to the server, so a refetch mid-edit cannot eat unsaved work.
 */
type Draft = ReadonlyMap<FeatureKey, Level>;

/** What one feature's row should show: the pending edit, or the stored truth. */
function levelFor(admin: Admin, draft: Draft, key: FeatureKey): Level {
  return draft.has(key) ? (draft.get(key) ?? null) : (admin.permissions[key] ?? null);
}

const LEVEL_WORDS: Record<PermissionLevel, string> = {
  [PERMISSION_LEVELS.READ]: 'read',
  [PERMISSION_LEVELS.WRITE]: 'write',
};

const levelWord = (level: Level) => (level === null ? 'none' : LEVEL_WORDS[level]);

interface Change {
  feature: Feature;
  from: Level;
  to: Level;
}

/** Losing something, as opposed to gaining it — what makes a save destructive. */
const isReduction = ({ from, to }: Change) =>
  to === null || (from === PERMISSION_LEVELS.WRITE && to === PERMISSION_LEVELS.READ);

/**
 * Who holds what, one admin at a time — granting is something you do TO a person.
 * Every panel starts open, so the screen can be scanned and found in.
 */
export function PermissionsPage() {
  const queryClient = useQueryClient();

  const features = useQuery({
    queryKey: QUERY_KEYS.FEATURES,
    queryFn: () => api.admin.features.list(),
  });
  const admins = useQuery({
    queryKey: [...QUERY_KEYS.ADMINS, 'all'],
    queryFn: () =>
      api.admin.admins.list({ page: 1, pageSize: PAGE_SIZE_FOR_PICKERS, activeOnly: 'true' }),
  });

  /** Both caches: a grant changes the feature's holders and the admin's permission map. */
  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.FEATURES });
    void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.ADMINS });
  }, [queryClient]);

  const registered = features.data ?? [];
  const rows = admins.data?.items ?? [];
  const isLoading = features.isPending || admins.isPending;

  return (
    <SuperAdminOnly title="Permissions">
      <PageFrame
        header={
          <>
            <PageHeader breadcrumbs={<PageCrumbs nav={NAV_ITEMS} />} title="Permissions" />

            {!isLoading && registered.length === 0 ? (
              <Alert variant="warning" className="mb-5">
                <span>
                  No features are defined, so there is nothing to grant. Feature keys live in the
                  code — screen first.
                </span>
              </Alert>
            ) : null}
          </>
        }
      >
        {isLoading ? (
          // Panel-shaped, because that is what is coming — a word would be replaced and jump.
          <div className="flex flex-col gap-3">
            <Skeleton className="h-14 rounded-lg" />
            <Skeleton className="h-14 rounded-lg" />
            <Skeleton className="h-14 rounded-lg" />
          </div>
        ) : null}

        <div className="flex flex-col gap-3">
          {rows.map((admin) => (
            <AdminPanel key={admin.id} admin={admin} features={registered} onSaved={refresh} />
          ))}
        </div>

        {!isLoading && rows.length === 0 ? (
          <Card className="p-4 text-sm text-muted-foreground">No active admins.</Card>
        ) : null}
      </PageFrame>
    </SuperAdminOnly>
  );
}

// ---------------------------------------------------------------------------

/**
 * One admin's access, edited as a set: the ticks are free and the SAVE is the deliberate step.
 * The draft lives here so the summary row can show the unsaved count when the panel is shut.
 */
function AdminPanel({
  admin,
  features,
  onSaved,
}: Readonly<{ admin: Admin; features: readonly Feature[]; onSaved: () => void }>) {
  const [draft, setDraft] = useState<Draft>(() => new Map<FeatureKey, Level>());
  const [confirming, setConfirming] = useState(false);

  const changes = useMemo<Change[]>(
    () =>
      features
        .map((feature) => ({
          feature,
          from: admin.permissions[feature.key] ?? null,
          to: levelFor(admin, draft, feature.key),
        }))
        .filter((change) => change.from !== change.to),
    [features, admin, draft],
  );

  const setLevel = (key: FeatureKey, next: Level) =>
    setDraft((previous) => {
      const updated = new Map(previous);
      // Ticking back to what is already stored is not a change. Dropping it
      // keeps the count honest and keeps the dialog free of no-op lines.
      if ((admin.permissions[key] ?? null) === next) updated.delete(key);
      else updated.set(key, next);
      return updated;
    });

  const save = useMutation({
    meta: { success: `Access updated for ${admin.email}.` },
    /** One feature at a time, revoking before granting so both levels are never held at once. */
    mutationFn: async () => {
      for (const change of changes) {
        if (change.from) {
          await api.admin.features.revoke({
            featureKey: change.feature.key,
            level: change.from,
            adminId: admin.id,
          });
        }
        if (change.to) {
          await api.admin.features.grant({
            featureKey: change.feature.key,
            level: change.to,
            adminId: admin.id,
          });
        }
      }
    },
    /**
     * Dropped whether this succeeded or failed: a run that stopped halfway has already
     * changed the earlier features, so only the server knows where it got to.
     */
    onSettled: () => {
      setDraft(new Map<FeatureKey, Level>());
      setConfirming(false);
      onSaved();
    },
  });

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
      meta={<PanelMeta admin={admin} features={features} changes={changes} heldCount={heldCount} />}
    >
      {admin.isSuperAdmin ? (
        // No checkboxes: a super admin bypasses every check, so a grant changes nothing.
        <Alert variant="info">
          <span>
            Bypasses every feature check, so there is nothing to grant. Remove super admin on the
            Admins screen to give them specific access instead.
          </span>
        </Alert>
      ) : (
        <>
          <FeatureGrid
            admin={admin}
            features={features}
            draft={draft}
            disabled={save.isPending}
            onSetLevel={setLevel}
          />

          {changes.length > 0 ? (
            <Alert variant="warning" className="mt-3">
              <div className="flex flex-1 flex-wrap items-center justify-between gap-2">
                <span>{plural(changes.length, 'unsaved change')} — nothing has been sent yet.</span>
                <div className="flex gap-2">
                  {/* Cancel is neutral grey, never red: discarding a draft destroys nothing. */}
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={save.isPending}
                    onClick={() => setDraft(new Map<FeatureKey, Level>())}
                  >
                    Discard
                  </Button>
                  <Button size="sm" loading={save.isPending} onClick={() => setConfirming(true)}>
                    Save changes
                  </Button>
                </div>
              </div>
            </Alert>
          ) : null}

          <ConfirmDialog
            open={confirming}
            onOpenChange={setConfirming}
            // Crimson only when something is being taken away. A save that only
            // grants is not a destructive act and should not be dressed as one.
            destructive={changes.some(isReduction)}
            loading={save.isPending}
            title={`Apply ${plural(changes.length, 'change')} to ${admin.email}?`}
            description={
              changes.some(isReduction)
                ? 'Anything removed here disappears from what they can reach the moment this saves — they do not have to sign out for it to take effect.'
                : 'They can use everything granted here as soon as this saves, without signing out and in again.'
            }
            confirmLabel="Apply changes"
            onConfirm={() => save.mutate()}
          >
            {/* The list IS the confirmation. A count alone asks somebody to
                trust their own memory of a dozen ticks. */}
            <div className="flex flex-col gap-1">
              {changes.map((change) => (
                <StatRow
                  key={change.feature.key}
                  label={<code className="text-xs">{change.feature.key}</code>}
                  value={`${levelWord(change.from)} → ${levelWord(change.to)}`}
                />
              ))}
            </div>
          </ConfirmDialog>
        </>
      )}
    </Accordion>
  );
}

/** Unsaved work wins the slot: this row is all that is visible once the panel is shut. */
function PanelMeta({
  admin,
  features,
  changes,
  heldCount,
}: Readonly<{
  admin: Admin;
  features: readonly Feature[];
  changes: readonly Change[];
  heldCount: number;
}>) {
  if (changes.length > 0) {
    return <Badge variant="warning">{plural(changes.length, 'unsaved change')}</Badge>;
  }

  if (admin.isSuperAdmin) {
    return (
      <Badge variant="primary">
        <ShieldCheck aria-hidden />
        Super admin
      </Badge>
    );
  }

  return (
    <Badge variant="neutral">
      <span className="tabular-nums">{heldCount}</span> of {features.length}
    </Badge>
  );
}

function FeatureGrid({
  admin,
  features,
  draft,
  disabled,
  onSetLevel,
}: Readonly<{
  admin: Admin;
  features: readonly Feature[];
  draft: Draft;
  disabled: boolean;
  onSetLevel: (key: FeatureKey, next: Level) => void;
}>) {
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
        <FeatureRow
          key={feature.key}
          admin={admin}
          feature={feature}
          level={levelFor(admin, draft, feature.key)}
          edited={draft.has(feature.key)}
          disabled={disabled}
          onSetLevel={onSetLevel}
        />
      ))}
    </div>
  );
}

function FeatureRow({
  admin,
  feature,
  level,
  edited,
  disabled,
  onSetLevel,
}: Readonly<{
  admin: Admin;
  feature: Feature;
  level: Level;
  /** Changed since the last save — marked, so a draft is never invisible. */
  edited: boolean;
  disabled: boolean;
  onSetLevel: (key: FeatureKey, next: Level) => void;
}>) {
  const hasWrite = level === PERMISSION_LEVELS.WRITE;
  /** Write implies read, so read is locked while write is held. */
  const hasRead = level !== null;

  return (
    <div className="flex items-center gap-2 border-b border-border py-1 last:border-b-0">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <code className="truncate">{feature.key}</code>
        {edited ? <Badge variant="warning">Edited</Badge> : null}
      </div>

      <div className="flex w-20 justify-center">
        <Checkbox
          checked={hasRead}
          disabled={disabled || hasWrite}
          aria-label={`Read access to ${feature.key} for ${admin.email}`}
          onChange={(event) =>
            onSetLevel(feature.key, event.target.checked ? PERMISSION_LEVELS.READ : null)
          }
        />
      </div>

      <div className="flex w-20 justify-center">
        <Checkbox
          checked={hasWrite}
          disabled={disabled}
          aria-label={`Write access to ${feature.key} for ${admin.email}`}
          // Un-ticking write removes the grant rather than demoting to read.
          onChange={(event) =>
            onSetLevel(feature.key, event.target.checked ? PERMISSION_LEVELS.WRITE : null)
          }
        />
      </div>
    </div>
  );
}
