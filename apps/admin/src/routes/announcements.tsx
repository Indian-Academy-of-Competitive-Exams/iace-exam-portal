import { useState } from 'react';
import { Plus } from 'lucide-react';
import { FEATURE_KEYS, PERMISSION_LEVELS, type Announcement } from '@iace/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { PageCrumbs, useListScreen } from '@iace/app-kit/browser';
import {
  Badge,
  BadgeList,
  Button,
  ListView,
  Metric,
  MetricGroup,
  PageHeader,
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

/** What an admin said, to whom, and what it cost. Immutable once sent, so no row actions. */
export function AnnouncementsPage() {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const [composing, setComposing] = useState(false);

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
              <Button size="sm" onClick={() => setComposing(true)}>
                <Plus aria-hidden />
                New announcement
              </Button>
            ) : undefined
          }
        />
      }
    >
      <ComposeAnnouncementDialog
        open={composing}
        onOpenChange={setComposing}
        onSent={() => {
          setComposing(false);
          void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.ANNOUNCEMENTS });
        }}
      />

      <ListView
        list={announcements}
        columns={COLUMNS}
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

const COLUMNS: DataTableColumn<Announcement>[] = [
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
  { key: 'read', header: 'Read', cell: (row) => row.stats.readCount.toLocaleString('en-IN') },
  {
    key: 'by',
    header: 'Sent by',
    className: 'max-w-48',
    cell: (row) => <TruncatedText>{row.createdBy.fullName ?? row.createdBy.email}</TruncatedText>,
  },
];

/** A row's own detail, never searched across, so it opens under the row rather than on a screen. */
function AnnouncementPanel({ announcement }: Readonly<{ announcement: Announcement }>) {
  const { stats } = announcement;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm">{announcement.body}</p>

      <MetricGroup>
        <Metric label="Sent" value={stats.sent} />
        <Metric label="Delivered" value={stats.delivered} />
        <Metric label="Failed" value={stats.failed} />
        <Metric label="Read" value={stats.readCount} />
        <Metric label="Not bought" value={stats.savedByRead} />
      </MetricGroup>
    </div>
  );
}
