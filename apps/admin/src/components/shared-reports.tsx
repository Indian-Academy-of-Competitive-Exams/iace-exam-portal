import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  FEATURE_KEYS,
  PERMISSION_LEVELS,
  defaultShareExpiry,
  shareExpiryLine,
  type PerformanceShare,
} from '@iace/contracts';
import {
  ShareTable,
  SharePicker,
  announceMinted,
  shareColumns,
  shareTitleOf,
  useChosenSitting,
} from '@iace/app-kit/browser';
import { ConfirmDialog, FormSection } from '@iace/ui';
import { api } from '../lib/api';
import { studentSharesQueryKey } from '../lib/constants';
import { useAuth } from '../providers/auth';

/** Public links onto this student's own reports — the one route to their data with no sign-in. */
export function SharedReportsCard({
  studentId,
  name,
}: Readonly<{ studentId: string; name: string }>) {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const [expiresOn, setExpiresOn] = useState(defaultShareExpiry);
  const [creating, setCreating] = useState(false);
  const [revoking, setRevoking] = useState<PerformanceShare | null>(null);

  const canRead = can(FEATURE_KEYS.STUDENT_PERFORMANCE);
  const canWrite = can(FEATURE_KEYS.STUDENT_PERFORMANCE, PERMISSION_LEVELS.WRITE);

  const held = useQuery({
    queryKey: studentSharesQueryKey(studentId),
    queryFn: () => api.admin.students.performanceShares(studentId),
    enabled: canRead,
  });
  const sitting = useChosenSitting(held.data?.sittings ?? []);

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: studentSharesQueryKey(studentId) });

  const create = useMutation({
    mutationFn: () =>
      api.admin.students.sharePerformance(studentId, {
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
    mutationFn: (id: string) => api.admin.students.revokePerformanceShare(studentId, id),
    onSuccess: async () => {
      setRevoking(null);
      await refresh();
    },
    onError: () => setRevoking(null),
  });

  const columns = useMemo(
    () => shareColumns(canWrite, revoke.isPending, setRevoking),
    [canWrite, revoke.isPending],
  );

  if (!canRead) return null;

  return (
    <FormSection title="Shared reports">
      <div className="flex flex-col gap-4">
        {canWrite ? (
          <SharePicker
            sittings={held.data?.sittings ?? []}
            attemptId={sitting.chosen}
            onAttemptChange={sitting.setAttemptId}
            expiresOn={expiresOn}
            onExpiryChange={setExpiresOn}
            creating={create.isPending}
            onCreate={() => setCreating(true)}
            placeholder="Choose a sitting"
          />
        ) : null}

        <ShareTable
          shares={held.data?.shares ?? []}
          columns={columns}
          isLoading={held.isLoading}
          isError={held.isError}
          error="This student's shared links did not load."
          onRetry={held.refetch}
          empty="No report of this student has been shared"
        />
      </div>

      <ConfirmDialog
        open={creating}
        onOpenChange={(open) => !open && setCreating(false)}
        loading={create.isPending}
        title={`Publish a link to ${name}'s report?`}
        description={`Anyone holding the link sees their name, branch, marks, rank and section scores for this sitting — no answer key and no other student. ${shareExpiryLine(expiresOn)} Either you or the student can revoke it.`}
        confirmLabel="Create link"
        onConfirm={() => create.mutate()}
      />

      <ConfirmDialog
        open={revoking !== null}
        onOpenChange={(open) => !open && setRevoking(null)}
        destructive
        loading={revoke.isPending}
        title={`Revoke the link to ${shareTitleOf(revoking)}?`}
        description={`The link stops working straight away for everyone holding it. ${name}'s report for ${shareTitleOf(revoking)} is unaffected.`}
        confirmLabel="Revoke link"
        onConfirm={() => revoking && revoke.mutate(revoking.id)}
      />
    </FormSection>
  );
}
