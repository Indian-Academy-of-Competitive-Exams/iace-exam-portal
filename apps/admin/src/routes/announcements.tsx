import { useState } from 'react';
import { Plus, Send } from 'lucide-react';
import { FEATURE_KEYS, PERMISSION_LEVELS, type AnnouncementSummary } from '@iace/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { PageCrumbs, useListScreen } from '@iace/app-kit/browser';
import {
  Badge,
  BadgeList,
  Button,
  DropdownMenuItem,
  ListView,
  Metric,
  MetricGroup,
  PageHeader,
  RowActions,
  Skeleton,
  TableFrame,
  TruncatedText,
  type DataTableColumn,
  type ListFilter,
} from '@iace/ui';
import { useAuth } from '../providers/auth';
import { api } from '../lib/api';
import { NAV_ITEMS, QUERY_KEYS } from '../lib/constants';
import { ComposeAnnouncementDialog } from '../components/announcements/compose-announcement-dialog';
import { CHANNEL_LABEL, rupees } from '../components/announcements/money';

/** Nothing to narrow yet: an announcement carries no dimension worth filtering a short list by. */
const NO_FILTERS = [] as const satisfies readonly ListFilter[];

/** What an admin said and to whom. A sent notice is immutable; the one action re-sends a copy. */
export function AnnouncementsPage() {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const [composing, setComposing] = useState(false);
  // The row being sent again, which is also the dialog's key: without it the form keeps the last one.
  const [resending, setResending] = useState<AnnouncementSummary | null>(null);

  const canSend = can(FEATURE_KEYS.NOTIFICATION_MANAGEMENT, PERMISSION_LEVELS.WRITE);

  const announcements = useListScreen({
    queryKey: QUERY_KEYS.ANNOUNCEMENTS,
    filters: NO_FILTERS,
    toQuery: () => ({}),
    fetchPage: (params) => api.admin.announcements.list(params),
  });

  return (
    <TableFrame
      header={
        <PageHeader
          breadcrumbs={<PageCrumbs nav={NAV_ITEMS} />}
          title="Announcements"
          action={
            canSend ? (
              <Button
                size="sm"
                onClick={() => {
                  setResending(null);
                  setComposing(true);
                }}
              >
                <Plus aria-hidden />
                New announcement
              </Button>
            ) : undefined
          }
        />
      }
    >
      <ComposeAnnouncementDialog
        key={resending?.id ?? 'new'}
        open={composing}
        onOpenChange={setComposing}
        draft={resending}
        onSent={() => {
          setComposing(false);
          void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.ANNOUNCEMENTS });
        }}
      />

      <ListView
        list={announcements}
        columns={columnsWith(
          canSend
            ? (row) => {
                setResending(row);
                setComposing(true);
              }
            : undefined,
        )}
        rowKey={(row) => row.id}
        expand={{
          render: (row) => <AnnouncementPanel announcement={row} />,
          label: () => 'Delivery',
        }}
        empty="No announcements yet."
      />
    </TableFrame>
  );
}

/** The action is left out rather than disabled for an admin who cannot send. */
const columnsWith = (
  onResend?: (row: AnnouncementSummary) => void,
): DataTableColumn<AnnouncementSummary>[] => [
  {
    key: 'title',
    header: 'Title',
    className: 'max-w-72',
    cell: (row) => <TruncatedText>{row.title}</TruncatedText>,
  },
  {
    key: 'recipients',
    header: 'Students',
    cell: (row) => row.recipientCount.toLocaleString('en-IN'),
  },
  {
    key: 'channels',
    header: 'Channels',
    cell: (row) =>
      row.paidChannels.length === 0 ? (
        <Badge variant="neutral">In-app only</Badge>
      ) : (
        <BadgeList items={row.paidChannels} label={(channel) => CHANNEL_LABEL[channel]} />
      ),
  },
  { key: 'cost', header: 'Cost', cell: (row) => rupees(row.estimatedCostPaise) },
  {
    key: 'by',
    header: 'Sent by',
    className: 'max-w-48',
    cell: (row) => <TruncatedText>{row.createdBy.fullName ?? row.createdBy.email}</TruncatedText>,
  },
  ...(onResend
    ? [
        {
          key: 'actions',
          header: '',
          cell: (row: AnnouncementSummary) => (
            <RowActions label={`Actions for ${row.title}`}>
              <DropdownMenuItem onSelect={() => onResend(row)}>
                <Send aria-hidden />
                Send again
              </DropdownMenuItem>
            </RowActions>
          ),
        },
      ]
    : []),
];

/** A row's own detail. The ledger is counted HERE — per row on the list is six queries each. */
function AnnouncementPanel({ announcement }: Readonly<{ announcement: AnnouncementSummary }>) {
  const detail = useQuery({
    queryKey: [...QUERY_KEYS.ANNOUNCEMENTS, announcement.id],
    queryFn: () => api.admin.announcements.detail(announcement.id),
  });

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm">{announcement.body}</p>

      {detail.data ? (
        <MetricGroup>
          <Metric label="Sent" value={detail.data.stats.sent} />
          <Metric label="Delivered" value={detail.data.stats.delivered} />
          <Metric label="Failed" value={detail.data.stats.failed} />
          <Metric label="Read" value={detail.data.stats.readCount} />
          <Metric label="Not bought" value={detail.data.stats.savedByRead} />
        </MetricGroup>
      ) : (
        <Skeleton variant="row" className="h-16" />
      )}
    </div>
  );
}
