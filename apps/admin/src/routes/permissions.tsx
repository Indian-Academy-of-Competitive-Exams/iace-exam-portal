import { useCallback, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ShieldCheck } from 'lucide-react';
import { PERMISSION_LEVELS, type Admin, type Feature, type PermissionLevel } from '@iace/contracts';
import {
  Accordion,
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  ConfirmDialog,
  PageHeader,
  plural,
  Skeleton,
  StatRow,
} from '@iace/ui';
import { api } from '../lib/api';
import { ADMINS_QUERY_KEY, FEATURES_QUERY_KEY, PAGE_SIZE_FOR_PICKERS } from '../lib/constants';
import { SuperAdminOnly } from '../components/super-admin-only';

/** What an admin holds for one feature, with "nothing" said out loud. */
type Level = PermissionLevel | null;

/**
 * The edits made since the last save, keyed by feature.
 *
 * A DIFF rather than a copy of the whole map, which is what lets a background
 * refetch land mid-edit without consequence: an untouched feature reads through
 * to whatever the server now says, and only the boxes actually ticked hold their
 * pending value. A full copy would have to be re-seeded from every refetch, and
 * that effect is the standard way a form like this eats someone's work.
 */
type Draft = ReadonlyMap<string, Level>;

/** What one feature's row should show: the pending edit, or the stored truth. */
function levelFor(admin: Admin, draft: Draft, key: string): Level {
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
   * only one leaves them showing the state from before the save.
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
        description="What each admin may do. Write covers create, update and delete, and always includes read. Tick what they should have, then save the lot."
      />

      {!isLoading && registered.length === 0 ? (
        <Alert variant="warning" className="mb-5">
          <span>
            No features are registered, so there is nothing to grant. Register one on the Features
            screen first.
          </span>
        </Alert>
      ) : null}

      {isLoading ? (
        // Panel-shaped, because that is what is coming — a word in a card would
        // be replaced by three of them and shove the page down.
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
    </SuperAdminOnly>
  );
}

// ---------------------------------------------------------------------------

/**
 * One admin's access, edited as a set and saved as one act.
 *
 * It used to fire a request per checkbox. That made the grid the one screen in
 * the app where an irreversible-feeling change happened with no confirmation —
 * and confirming each tick was not the answer either, because setting up a new
 * admin is a dozen ticks and a dozen dialogs is how someone learns to click
 * through dialogs without reading them. So the ticks are free and the SAVE is
 * the deliberate step: one dialog, listing exactly what is about to change.
 *
 * The draft lives here rather than in the grid so the summary row can carry the
 * unsaved count — a panel folded shut must not hide pending work.
 */
function AdminPanel({
  admin,
  features,
  onSaved,
}: Readonly<{ admin: Admin; features: readonly Feature[]; onSaved: () => void }>) {
  const [draft, setDraft] = useState<Draft>(() => new Map<string, Level>());
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

  const setLevel = (key: string, next: Level) =>
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
    /**
     * One feature at a time, revoking before granting so both levels are never
     * held at once. The server resolves that case to WRITE anyway, but a row
     * saying one thing while the screen says another is its own bug.
     */
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
     * The draft is dropped whether this succeeded or failed, and the caches are
     * refetched either way.
     *
     * A failure halfway through leaves the earlier features already changed, so
     * the only honest thing the grid can show afterwards is what the server
     * actually holds. Keeping the draft would leave ticks claiming to be pending
     * that had in fact been applied. The toast says it failed; the boxes say
     * where it got to.
     */
    onSettled: () => {
      setDraft(new Map<string, Level>());
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
        // No checkboxes. A super admin bypasses every check, so a grant would be
        // a row that changes nothing — rendering the controls would imply that
        // ticking them mattered.
        <p className="text-sm text-muted-foreground">
          Bypasses every feature check, so there is nothing to grant. Remove super admin on the
          Admins screen to give them specific access instead.
        </p>
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
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
              <p className="text-sm text-muted-foreground">
                {plural(changes.length, 'unsaved change')} — nothing has been sent yet.
              </p>
              <div className="flex gap-2">
                {/* Cancel is neutral grey, never red: discarding a draft
                    destroys nothing that exists. */}
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={save.isPending}
                  onClick={() => setDraft(new Map<string, Level>())}
                >
                  Discard
                </Button>
                <Button size="sm" loading={save.isPending} onClick={() => setConfirming(true)}>
                  Save changes
                </Button>
              </div>
            </div>
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
                  key={change.feature.id}
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

/**
 * The badge on the summary row.
 *
 * Unsaved work wins the slot, because this row is all that is visible once the
 * panel is folded shut, and a draft nobody can see is a draft somebody loses.
 */
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
  onSetLevel: (key: string, next: Level) => void;
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
          key={feature.id}
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
  onSetLevel: (key: string, next: Level) => void;
}>) {
  const hasWrite = level === PERMISSION_LEVELS.WRITE;
  /**
   * Write implies read, so read is ticked and locked whenever write is held.
   * The tick is a consequence rather than a choice, and leaving it clickable
   * would offer "write but not read" — a state the server cannot represent.
   */
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
          // Un-ticking write removes the grant outright rather than demoting to
          // read: the box you clicked is the thing that goes away, and read is
          // one click back if that is what was meant.
          onChange={(event) =>
            onSetLevel(feature.key, event.target.checked ? PERMISSION_LEVELS.WRITE : null)
          }
        />
      </div>
    </div>
  );
}
