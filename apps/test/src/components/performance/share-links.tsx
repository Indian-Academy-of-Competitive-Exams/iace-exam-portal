import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Link2, Trash2 } from 'lucide-react';
import {
  INSTITUTE_TIME_ZONE,
  PERFORMANCE_SHARE_DEFAULT_DAYS,
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
  RowActions,
  SectionHeading,
  TruncatedText,
  toast,
  type DataTableColumn,
} from '@iace/ui';
import { api } from '../../lib/api';
import { PERFORMANCE_SHARES_QUERY_KEY } from '../../lib/constants';

const UNTITLED = 'Untitled test';
const NO_EXPIRY = 'No expiry';

const WHEN = new Intl.DateTimeFormat('en-IN', {
  timeZone: INSTITUTE_TIME_ZONE,
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const defaultExpiry = () =>
  civilDate(new Date(Date.now() + PERFORMANCE_SHARE_DEFAULT_DAYS * MS_PER_DAY));

const linkFor = (token: string) => `${window.location.origin}${sharedReportPath(token)}`;

const when = (at: string | null) => (at === null ? null : WHEN.format(new Date(at)));

function StatusBadge({ share }: Readonly<{ share: PerformanceShare }>) {
  if (share.isLive) return <Badge variant="success">Live</Badge>;
  return <Badge variant="neutral">{share.revokedAt === null ? 'Expired' : 'Revoked'}</Badge>;
}

function shareColumns(
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

/** A public link to one of their own sittings, and every link they have already handed out. */
export function ShareLinks() {
  const queryClient = useQueryClient();
  const [attemptId, setAttemptId] = React.useState('');
  const [expiresOn, setExpiresOn] = React.useState(defaultExpiry);
  const [creating, setCreating] = React.useState(false);
  const [revoking, setRevoking] = React.useState<PerformanceShare | null>(null);

  const held = useQuery({
    queryKey: PERFORMANCE_SHARES_QUERY_KEY,
    queryFn: () => api.me.performanceShares(),
  });
  const sittings = held.data?.sittings ?? [];
  const chosen = sittings.some((row) => row.attemptId === attemptId)
    ? attemptId
    : (sittings[0]?.attemptId ?? '');
  const chosenTitle = sittings.find((row) => row.attemptId === chosen)?.testTitle ?? UNTITLED;

  const refresh = () => queryClient.invalidateQueries({ queryKey: PERFORMANCE_SHARES_QUERY_KEY });

  const create = useMutation({
    mutationFn: () =>
      api.me.sharePerformance({
        attemptId: chosen,
        expiresOn: expiresOn === '' ? null : expiresOn,
      }),
    onSuccess: async (share) => {
      setCreating(false);
      if (share.token !== null) void navigator.clipboard.writeText(linkFor(share.token));
      toast.success('Link created and copied.');
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
    () => shareColumns(revoke.isPending, setRevoking),
    [revoke.isPending],
  );

  return (
    <div className="flex flex-col gap-4">
      <SectionHeading title="Shared links" />

      {held.isError ? <Alert variant="danger">Your shared links did not load.</Alert> : null}

      <div className="flex flex-wrap items-end gap-3">
        <Field htmlFor="shareSitting" label="Sitting" className="min-w-56 flex-1">
          {({ id, 'aria-describedby': describedBy }) => (
            <Combobox
              id={id}
              aria-describedby={describedBy}
              clearable={false}
              value={chosen}
              onChange={setAttemptId}
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

      <DataTable
        columns={columns}
        rows={held.data?.shares ?? []}
        rowKey={(share) => share.id}
        isLoading={held.isLoading}
        skeletonRows={2}
        scroll={{}}
        empty={<Alert variant="info">You have not shared a report yet.</Alert>}
      />

      <ConfirmDialog
        open={creating}
        onOpenChange={(open) => !open && setCreating(false)}
        loading={create.isPending}
        title={`Share your report for ${chosenTitle}?`}
        description={`Anyone holding the link sees your name, branch, marks, rank and section scores for this sitting — no answer key and no other student. ${expiryLine(expiresOn)} You can revoke it at any time.`}
        confirmLabel="Create link"
        onConfirm={() => create.mutate()}
      />

      <ConfirmDialog
        open={revoking !== null}
        onOpenChange={(open) => !open && setRevoking(null)}
        destructive
        loading={revoke.isPending}
        title={`Revoke the link to ${revoking?.testTitle ?? UNTITLED}?`}
        description={`The link stops working straight away for everyone holding it. Your report for ${revoking?.testTitle ?? UNTITLED} is unaffected.`}
        confirmLabel="Revoke link"
        onConfirm={() => revoking && revoke.mutate(revoking.id)}
      />
    </div>
  );
}

function sittingItem(sitting: ShareableSitting) {
  const sat = when(sitting.submittedAt);
  const title = sitting.testTitle ?? UNTITLED;
  return { value: sitting.attemptId, label: sat === null ? title : `${title} · ${sat}` };
}

/** A `YYYY-MM-DD` picked in the browser, read back as the civil date it names, never a zone. */
const civilInstant = (day: string) => new Date(`${day}T00:00:00Z`);

const expiryLine = (expiresOn: string) =>
  expiresOn === ''
    ? 'It never expires.'
    : `It stops working after ${WHEN.format(civilInstant(expiresOn))}.`;
