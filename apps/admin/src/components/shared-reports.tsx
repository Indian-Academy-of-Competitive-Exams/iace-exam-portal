import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Link2, Trash2 } from 'lucide-react';
import {
  FEATURE_KEYS,
  INSTITUTE_TIME_ZONE,
  PERFORMANCE_SHARE_DEFAULT_DAYS,
  PERMISSION_LEVELS,
  civilDate,
  sharedReportPath,
  todayISO,
  type PerformanceShare,
  type ShareableSitting,
} from '@iace/contracts';
import {
  Alert,
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
import { QUERY_KEYS } from '../lib/constants';
import { useAuth } from '../providers/auth';

const UNTITLED = 'Untitled test';
const NO_EXPIRY = 'No expiry';
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const WHEN = new Intl.DateTimeFormat('en-IN', {
  timeZone: INSTITUTE_TIME_ZONE,
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

const when = (at: string | null) => (at === null ? null : WHEN.format(new Date(at)));

const sharesKey = (studentId: string) => [...QUERY_KEYS.STUDENT, studentId, 'shares'] as const;

const defaultExpiry = () =>
  civilDate(new Date(Date.now() + PERFORMANCE_SHARE_DEFAULT_DAYS * MS_PER_DAY));

const linkFor = (token: string) => `${window.location.origin}${sharedReportPath(token)}`;

const sittingItem = (sitting: ShareableSitting) => {
  const sat = when(sitting.submittedAt);
  const title = sitting.testTitle ?? UNTITLED;
  return { value: sitting.attemptId, label: sat === null ? title : `${title} · ${sat}` };
};

/** A `YYYY-MM-DD` picked in the browser, read back as the civil date it names, never a zone. */
const civilInstant = (day: string) => new Date(`${day}T00:00:00Z`);

const expiryLine = (expiresOn: string) =>
  expiresOn === ''
    ? 'It never expires.'
    : `It stops working after ${WHEN.format(civilInstant(expiresOn))}.`;

function StatusBadge({ share }: Readonly<{ share: PerformanceShare }>) {
  if (share.isLive) return <Badge variant="success">Live</Badge>;
  return <Badge variant="neutral">{share.revokedAt === null ? 'Expired' : 'Revoked'}</Badge>;
}

function shareColumns(
  canWrite: boolean,
  busy: boolean,
  onRevoke: (share: PerformanceShare) => void,
): DataTableColumn<PerformanceShare>[] {
  return [
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
      cell: (share) => <TruncatedText>{when(share.createdAt)}</TruncatedText>,
    },
    {
      key: 'expires',
      header: 'Expires',
      className: 'max-w-36',
      cell: (share) => <TruncatedText>{when(share.expiresAt) ?? NO_EXPIRY}</TruncatedText>,
    },
    {
      key: 'status',
      header: 'Status',
      className: 'max-w-28',
      cell: (share) => <StatusBadge share={share} />,
    },
    {
      key: 'actions',
      cell: (share) => (
        <RowActions label={`Actions for the link to ${share.testTitle ?? UNTITLED}`}>
          <DropdownMenuItem
            onSelect={() => {
              void navigator.clipboard.writeText(linkFor(share.token));
              toast.success('Link copied.');
            }}
          >
            <Copy aria-hidden />
            Copy link
          </DropdownMenuItem>
          {canWrite && share.isLive ? (
            <DropdownMenuItem destructive disabled={busy} onSelect={() => onRevoke(share)}>
              <Trash2 aria-hidden />
              Revoke link
            </DropdownMenuItem>
          ) : null}
        </RowActions>
      ),
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
  const [expiresOn, setExpiresOn] = useState(defaultExpiry);
  const [creating, setCreating] = useState(false);
  const [revoking, setRevoking] = useState<PerformanceShare | null>(null);

  const canRead = can(FEATURE_KEYS.STUDENT_PERFORMANCE);
  const canWrite = can(FEATURE_KEYS.STUDENT_PERFORMANCE, PERMISSION_LEVELS.WRITE);

  const held = useQuery({
    queryKey: sharesKey(studentId),
    queryFn: () => api.admin.students.performanceShares(studentId),
    enabled: canRead,
  });
  const sittings = held.data?.sittings ?? [];
  const chosen = sittings.some((row) => row.attemptId === attemptId)
    ? attemptId
    : (sittings[0]?.attemptId ?? '');

  const refresh = () => queryClient.invalidateQueries({ queryKey: sharesKey(studentId) });

  const create = useMutation({
    mutationFn: () =>
      api.admin.students.sharePerformance(studentId, {
        attemptId: chosen,
        expiresOn: expiresOn === '' ? null : expiresOn,
      }),
    onSuccess: async (share) => {
      setCreating(false);
      void navigator.clipboard.writeText(linkFor(share.token));
      toast.success('Link created and copied.');
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
                  items={sittings.map(sittingItem)}
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
          skeletonRows={2}
          scroll={{}}
          empty={<Alert variant="info">No report of this student has been shared.</Alert>}
        />
      </div>

      <ConfirmDialog
        open={creating}
        onOpenChange={(open) => !open && setCreating(false)}
        loading={create.isPending}
        title={`Publish a link to ${name}'s report?`}
        description={`Anyone holding the link sees their name, branch, marks, rank and section scores for this sitting — no answer key and no other student. ${expiryLine(expiresOn)} Either you or the student can revoke it.`}
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
