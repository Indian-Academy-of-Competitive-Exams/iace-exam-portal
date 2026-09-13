/**
 * The half of a share-links screen that is the same in both portals: how a token becomes a URL,
 * what a dead link does, the columns, and the picker. Who may create one, whose report it is and
 * what the confirm says are the portal's own, and stay at the call site.
 */

import * as React from 'react';
import { Copy, Link2, Trash2 } from 'lucide-react';
import {
  SHARE_STATUS,
  instituteDayLabel,
  shareStatusOf,
  sharedReportPath,
  sittingLabel,
  todayISO,
  type PerformanceShare,
  type ShareableSitting,
} from '@iace/contracts';
import {
  Badge,
  Button,
  Combobox,
  DataTable,
  DatePicker,
  DropdownMenuItem,
  Field,
  RowActions,
  TruncatedText,
  toast,
  type DataTableColumn,
} from '@iace/ui';
import { absoluteUrl } from './index';

const UNTITLED = 'Untitled test';
const NO_EXPIRY = 'No expiry';

export const shareLinkFor = (token: string): string => absoluteUrl(sharedReportPath(token));

export const shareTitleOf = (share: Pick<PerformanceShare, 'testTitle'> | null): string =>
  share?.testTitle ?? UNTITLED;

/** A link that is already dead must not be reported as copied — the toast is the only feedback. */
export function announceMinted(share: PerformanceShare): void {
  if (share.token === null || !share.isLive) {
    toast.error('Link created, but it has already expired.');
    return;
  }
  void navigator.clipboard.writeText(shareLinkFor(share.token));
  toast.success('Link created and copied.');
}

export function ShareStatusBadge({ share }: Readonly<{ share: PerformanceShare }>) {
  const status = shareStatusOf(share);
  return <Badge variant={status === SHARE_STATUS.LIVE ? 'success' : 'neutral'}>{status}</Badge>;
}

/** Only a writer is handed a working token, so a reader gets no actions column at all. */
export function shareColumns(
  canWrite: boolean,
  busy: boolean,
  onRevoke: (share: PerformanceShare) => void,
): DataTableColumn<PerformanceShare>[] {
  const columns: DataTableColumn<PerformanceShare>[] = [
    {
      key: 'test',
      header: 'Test',
      className: 'max-w-64',
      cell: (share) => <TruncatedText>{shareTitleOf(share)}</TruncatedText>,
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
      cell: (share) => <ShareStatusBadge share={share} />,
    },
  ];
  if (!canWrite) return columns;

  return [
    ...columns,
    {
      key: 'actions',
      cell: (share) => {
        const link = share.token === null ? null : shareLinkFor(share.token);
        return (
          <RowActions label={`Actions for the link to ${shareTitleOf(share)}`}>
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

export interface SharePickerProps {
  sittings: readonly ShareableSitting[];
  attemptId: string;
  onAttemptChange: (attemptId: string) => void;
  expiresOn: string;
  onExpiryChange: (expiresOn: string) => void;
  creating: boolean;
  onCreate: () => void;
  placeholder?: string;
}

export function SharePicker({
  sittings,
  attemptId,
  onAttemptChange,
  expiresOn,
  onExpiryChange,
  creating,
  onCreate,
  placeholder,
}: Readonly<SharePickerProps>) {
  return (
    <div className="flex flex-wrap items-end gap-3">
      <Field htmlFor="shareSitting" label="Sitting" className="min-w-56 flex-1">
        {({ id, 'aria-describedby': describedBy }) => (
          <Combobox
            id={id}
            aria-describedby={describedBy}
            clearable={false}
            value={attemptId}
            onChange={onAttemptChange}
            placeholder={placeholder}
            items={sittings.map((row) => ({ value: row.attemptId, label: sittingLabel(row) }))}
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
            onChange={onExpiryChange}
            min={todayISO()}
          />
        )}
      </Field>

      <Button
        type="button"
        variant="outline"
        disabled={attemptId === ''}
        loading={creating}
        onClick={onCreate}
      >
        <Link2 aria-hidden />
        Create link
      </Button>
    </div>
  );
}

export interface ShareTableProps {
  shares: readonly PerformanceShare[];
  columns: DataTableColumn<PerformanceShare>[];
  isLoading: boolean;
  isError: boolean;
  error: string;
  onRetry: () => void;
  empty: string;
}

export function ShareTable({
  shares,
  columns,
  isLoading,
  isError,
  error,
  onRetry,
  empty,
}: Readonly<ShareTableProps>) {
  return (
    <DataTable
      columns={columns}
      rows={shares}
      rowKey={(share) => share.id}
      isLoading={isLoading}
      isError={isError}
      error={error}
      onRetry={onRetry}
      skeletonRows={2}
      scroll={{}}
      empty={empty}
    />
  );
}

/** The first sitting is the default, and a chosen one that has gone stops being the choice. */
export function useChosenSitting(sittings: readonly ShareableSitting[]) {
  const [attemptId, setAttemptId] = React.useState('');

  const chosen = sittings.some((row) => row.attemptId === attemptId)
    ? attemptId
    : (sittings[0]?.attemptId ?? '');

  return {
    chosen,
    setAttemptId,
    title: shareTitleOf(sittings.find((r) => r.attemptId === chosen) ?? null),
  };
}
