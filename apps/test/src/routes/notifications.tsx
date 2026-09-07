/**
 * The student's bell. A DELIBERATE deviation from the list-screen convention, for the same reason
 * `tests.tsx` gives: this is something a student reads, not an admin data table, so it is a feed of
 * cards rather than a ListView.
 */
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useFilterSpec } from '@iace/app-kit/browser';
import { BellOff, SearchX } from 'lucide-react';
import {
  Alert,
  Badge,
  EmptyState,
  PageHeader,
  PanelFrame,
  Skeleton,
  cn,
  plural,
  type ListFilter,
} from '@iace/ui';
import {
  INSTITUTE_TIME_ZONE,
  NOTIFICATION_TYPE,
  type Notification,
  type NotificationType,
} from '@iace/contracts';
import { api } from '../lib/api';
import {
  NOTIFICATIONS_PAGE_SIZE,
  ROUTES,
  UNREAD_QUERY_KEY,
  notificationsQueryKey,
} from '../lib/constants';

const READ_STATE = { ALL: '', UNREAD: 'unread' } as const;

const SKELETON_KEYS = ['a', 'b', 'c', 'd'];

/** What the exam world calls each of these, not what the enum spells. */
const TYPE_LABEL: Record<NotificationType, string> = {
  [NOTIFICATION_TYPE.RESULT_READY]: 'Result',
  [NOTIFICATION_TYPE.TEST_ASSIGNED]: 'Test',
  [NOTIFICATION_TYPE.GRANT_ADDED]: 'Access',
  [NOTIFICATION_TYPE.ENROLLMENT_ADDED]: 'Enrolment',
  [NOTIFICATION_TYPE.GENERIC]: 'Notice',
};

const FILTERS = [
  {
    key: 'state',
    kind: 'choice',
    label: 'Show',
    primary: true,
    items: [
      { value: READ_STATE.UNREAD, label: 'Unread' },
      { value: READ_STATE.ALL, label: 'All' },
    ],
  },
] as const satisfies readonly ListFilter[];

export function NotificationsPage() {
  const filters = useFilterSpec(FILTERS);
  const unreadOnly = filters.values.state === READ_STATE.UNREAD;

  const list = useQuery({
    queryKey: notificationsQueryKey(unreadOnly),
    queryFn: () =>
      api.me.notifications({
        ...(unreadOnly ? { unreadOnly: 'true' } : {}),
        page: 1,
        pageSize: NOTIFICATIONS_PAGE_SIZE,
      }),
  });

  const rows = list.data?.items ?? [];

  return (
    <PanelFrame
      header={
        <PageHeader title="Notifications" meta={plural(list.data?.total ?? 0, 'notification')} />
      }
      filters={{ spec: FILTERS, state: filters }}
    >
      <FeedRegion list={list} rows={rows} unreadOnly={unreadOnly} />
    </PanelFrame>
  );
}

/** Loading and failing are not "none yet", and a filtered empty is not an empty bell. */
function FeedRegion({
  list,
  rows,
  unreadOnly,
}: Readonly<{
  list: { isLoading: boolean; isError: boolean };
  rows: readonly Notification[];
  unreadOnly: boolean;
}>) {
  if (list.isLoading) {
    return (
      <div className="flex flex-col gap-3">
        {SKELETON_KEYS.map((key) => (
          <Skeleton key={key} variant="row" className="h-20 rounded-lg" />
        ))}
      </div>
    );
  }
  if (list.isError) {
    return <Alert variant="danger">Your notifications did not load.</Alert>;
  }
  if (rows.length === 0) {
    return unreadOnly ? (
      <EmptyState icon={SearchX} title="Nothing unread" />
    ) : (
      <EmptyState icon={BellOff} title="No notifications yet" />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {rows.map((row) => (
        <NotificationCard key={row.id} notification={row} />
      ))}
    </div>
  );
}

/** One of many of the same thing, which is the boundary a card is for. */
function NotificationCard({ notification }: Readonly<{ notification: Notification }>) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const open = useMutation({
    mutationFn: () => api.me.readNotification(notification.id),
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: ['me', 'notifications'] });
      await queryClient.invalidateQueries({ queryKey: UNREAD_QUERY_KEY });
    },
  });

  const destination = destinationOf(notification);

  const read = () => {
    if (!notification.isRead) open.mutate();
    if (destination) navigate(destination);
  };

  return (
    <button
      type="button"
      onClick={read}
      className={cn(
        'focus-visible:shadow-focus hover:bg-muted/50 rounded-lg border p-4 text-start transition-colors',
        notification.isRead ? 'bg-card' : 'bg-card border-primary/40',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <span className="font-medium">{notification.title}</span>
        <Badge variant={notification.isRead ? 'neutral' : 'primary'}>
          {TYPE_LABEL[notification.type]}
        </Badge>
      </div>
      {notification.body ? <p className="mt-1 text-sm">{notification.body}</p> : null}
      <span className="text-muted-foreground mt-2 block text-xs">
        {whenItArrived(notification.createdAt)}
      </span>
    </button>
  );
}

/** The deep link the notification carries, or nothing — a notice opens no screen of its own. */
function destinationOf(notification: Notification): string | null {
  if (notification.testId) return ROUTES.TEST_ABOUT(notification.testId);
  if (notification.testSeriesId) return ROUTES.SERIES(notification.testSeriesId);
  return null;
}

/** The institute's clock, never the device's — a student in another zone reads the same day. */
function whenItArrived(at: string): string {
  return new Date(at).toLocaleString('en-IN', {
    timeZone: INSTITUTE_TIME_ZONE,
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}
