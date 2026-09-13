import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { defaultShareExpiry, shareExpiryLine, type PerformanceShare } from '@iace/contracts';
import {
  ShareTable,
  SharePicker,
  announceMinted,
  shareColumns,
  shareTitleOf,
  useChosenSitting,
} from '@iace/app-kit/browser';
import { ConfirmDialog, SectionHeading } from '@iace/ui';
import { api } from '../../lib/api';
import { PERFORMANCE_SHARES_QUERY_KEY } from '../../lib/constants';

/** A public link to one of their own sittings, and every link they have already handed out. */
export function ShareLinks() {
  const queryClient = useQueryClient();
  const [expiresOn, setExpiresOn] = React.useState(defaultShareExpiry);
  const [creating, setCreating] = React.useState(false);
  const [revoking, setRevoking] = React.useState<PerformanceShare | null>(null);

  const held = useQuery({
    queryKey: PERFORMANCE_SHARES_QUERY_KEY,
    queryFn: () => api.me.performanceShares(),
  });
  const sitting = useChosenSitting(held.data?.sittings ?? []);

  const refresh = () => queryClient.invalidateQueries({ queryKey: PERFORMANCE_SHARES_QUERY_KEY });

  const create = useMutation({
    mutationFn: () =>
      api.me.sharePerformance({
        attemptId: sitting.chosen,
        expiresOn: expiresOn === '' ? null : expiresOn,
      }),
    onSuccess: async (share) => {
      setCreating(false);
      announceMinted(share);
      await refresh();
    },
    onError: () => setCreating(false),
  });

  const revoke = useMutation({
    meta: { success: 'Link revoked.' },
    mutationFn: (id: string) => api.me.revokePerformanceShare(id),
    onSuccess: async () => {
      setRevoking(null);
      await refresh();
    },
    onError: () => setRevoking(null),
  });

  const columns = React.useMemo(
    () => shareColumns(true, revoke.isPending, setRevoking),
    [revoke.isPending],
  );

  return (
    <div className="flex flex-col gap-4">
      <SectionHeading title="Shared links" />

      <SharePicker
        sittings={held.data?.sittings ?? []}
        attemptId={sitting.chosen}
        onAttemptChange={sitting.setAttemptId}
        expiresOn={expiresOn}
        onExpiryChange={setExpiresOn}
        creating={create.isPending}
        onCreate={() => setCreating(true)}
      />

      <ShareTable
        shares={held.data?.shares ?? []}
        columns={columns}
        isLoading={held.isLoading}
        isError={held.isError}
        error="Your shared links did not load."
        onRetry={held.refetch}
        empty="You have not shared a report yet"
      />

      <ConfirmDialog
        open={creating}
        onOpenChange={(open) => !open && setCreating(false)}
        loading={create.isPending}
        title={`Share your report for ${sitting.title}?`}
        description={`Anyone holding the link sees your name, branch, marks, rank and section scores for this sitting — no answer key and no other student. ${shareExpiryLine(expiresOn)} You can revoke it at any time.`}
        confirmLabel="Create link"
        onConfirm={() => create.mutate()}
      />

      <ConfirmDialog
        open={revoking !== null}
        onOpenChange={(open) => !open && setRevoking(null)}
        destructive
        loading={revoke.isPending}
        title={`Revoke the link to ${shareTitleOf(revoking)}?`}
        description={`The link stops working straight away for everyone holding it. Your report for ${shareTitleOf(revoking)} is unaffected.`}
        confirmLabel="Revoke link"
        onConfirm={() => revoking && revoke.mutate(revoking.id)}
      />
    </div>
  );
}
