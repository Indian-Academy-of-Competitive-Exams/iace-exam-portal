import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Link2, Trash2 } from 'lucide-react';
import {
  FEATURE_KEYS,
  PERMISSION_LEVELS,
  SHARE_STATUS,
  defaultShareExpiry,
  instituteDayLabel,
  shareExpiryLine,
  shareStatusOf,
  sharedReportPath,
  sittingLabel,
  todayISO,
  type PerformanceShare,
} from '@iace/contracts';
import { absoluteUrl } from '@iace/app-kit/browser';
import {
  Badge,
  Button,
  Combobox,
  ConfirmDialog,
  DataTable,
  DatePicker,
  DropdownMenuItem,
  Field,
  FormSection,
  RowActions,
  TruncatedText,
  toast,
  type DataTableColumn,
} from '@iace/ui';
import { api } from '../lib/api';
import { studentSharesQueryKey } from '../lib/constants';
import { useAuth } from '../providers/auth';

const UNTITLED = 'Untitled test';
const NO_EXPIRY = 'No expiry';

const linkFor = (token: string) => absoluteUrl(sharedReportPath(token));

/** A link that is already dead must not be reported as copied — the toast is the only feedback. */
function announceMinted(share: PerformanceShare) {
  if (share.token === null || !share.isLive) {
    toast.error('Link created, but it has already expired.');
    return;
  }
  void navigator.clipboard.writeText(linkFor(share.token));
  toast.success('Link created and copied.');
}

function StatusBadge({ share }: Readonly<{ share: PerformanceShare }>) {
  const status = shareStatusOf(share);
  return <Badge variant={status === SHARE_STATUS.LIVE ? 'success' : 'neutral'}>{status}</Badge>;
}

/** Only WRITE is handed a working token, so a READ-only admin gets no actions column at all. */
function shareColumns(
  canWrite: boolean,
  busy: boolean,
  onRevoke: (share: PerformanceShare) => void,
): DataTableColumn<PerformanceShare>[] {
  const columns: DataTableColumn<PerformanceShare>[] = [
    {
      key: 'test',
      header: 'Test',
      className: 'max-w-64',
      cell: (share) => <TruncatedText>{share.testTitle ?? UNTITLED}</TruncatedText>,
    },
    {
      key: 'created',
      header: 'Created',
      className: 'max-w-36',
      cell: (share) => <TruncatedText>{instituteDayLabel(share.createdAt)}</TruncatedText>,
    },
    {
      key: 'expires',
      header: 'Expires',
      className: 'max-w-36',
      cell: (share) => (
        <TruncatedText>{instituteDayLabel(share.expiresAt) ?? NO_EXPIRY}</TruncatedText>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      className: 'max-w-28',
      cell: (share) => <StatusBadge share={share} />,
    },
  ];
  if (!canWrite) return columns;

  return [
    ...columns,
    {
      key: 'actions',
      cell: (share) => {
        const link = share.token === null ? null : linkFor(share.token);
        return (
          <RowActions label={`Actions for the link to ${share.testTitle ?? UNTITLED}`}>
            {link === null ? null : (
              <DropdownMenuItem
                onSelect={() => {
                  void navigator.clipboard.writeText(link);
                  toast.success('Link copied.');
                }}
              >
                <Copy aria-hidden />
                Copy link
              </DropdownMenuItem>
            )}
            {share.isLive ? (
              <DropdownMenuItem destructive disabled={busy} onSelect={() => onRevoke(share)}>
                <Trash2 aria-hidden />
                Revoke link
              </DropdownMenuItem>
            ) : null}
          </RowActions>
        );
      },
    },
  ];
}

/** Public links onto this student's own reports — the one route to their data with no sign-in. */
export function SharedReportsCard({
  studentId,
  name,
}: Readonly<{ studentId: string; name: string }>) {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const [attemptId, setAttemptId] = useState('');
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
  const sittings = held.data?.sittings ?? [];
  const chosen = sittings.some((row) => row.attemptId === attemptId)
    ? attemptId
    : (sittings[0]?.attemptId ?? '');

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: studentSharesQueryKey(studentId) });

  const create = useMutation({
    mutationFn: () =>
      api.admin.students.sharePerformance(studentId, {
        attemptId: chosen,
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
          <div className="flex flex-wrap items-end gap-3">
            <Field htmlFor="shareSitting" label="Sitting" className="min-w-56 flex-1">
              {({ id, 'aria-describedby': describedBy }) => (
                <Combobox
                  id={id}
                  aria-describedby={describedBy}
                  clearable={false}
                  value={chosen}
                  onChange={setAttemptId}
                  placeholder="Choose a sitting"
                  items={sittings.map((row) => ({
                    value: row.attemptId,
                    label: sittingLabel(row),
                  }))}
                />
              )}
            </Field>

            <Field
              htmlFor="shareExpiry"
              label="Expires on"
              // ui-copy-ok: rule — an empty picker is a link that never dies, which nothing else says
              hint="Clear it for a link with no expiry"
              className="min-w-52"
            >
              {({ id, 'aria-describedby': describedBy }) => (
                <DatePicker
                  id={id}
                  aria-describedby={describedBy}
                  value={expiresOn}
                  onChange={setExpiresOn}
                  min={todayISO()}
                />
              )}
            </Field>

            <Button
              type="button"
              variant="outline"
              disabled={chosen === ''}
              loading={create.isPending}
              onClick={() => setCreating(true)}
            >
              <Link2 aria-hidden />
              Create link
            </Button>
          </div>
        ) : null}

        <DataTable
          columns={columns}
          rows={held.data?.shares ?? []}
          rowKey={(share) => share.id}
          isLoading={held.isLoading}
          isError={held.isError}
          error="This student's shared links did not load."
          onRetry={held.refetch}
          skeletonRows={2}
          scroll={{}}
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
        title={`Revoke the link to ${revoking?.testTitle ?? UNTITLED}?`}
        description={`The link stops working straight away for everyone holding it. ${name}'s report for ${revoking?.testTitle ?? UNTITLED} is unaffected.`}
        confirmLabel="Revoke link"
        onConfirm={() => revoking && revoke.mutate(revoking.id)}
      />
    </FormSection>
  );
}
