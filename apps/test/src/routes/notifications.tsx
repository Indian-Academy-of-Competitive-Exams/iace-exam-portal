/**
 * The student's bell. A DELIBERATE deviation from the list-screen convention, for the same reason
 * `tests.tsx` gives: this is something a student reads, not an admin data table, so it is a feed
 * parted by hairlines inside one panel rather than a ListView.
 */
import * as React from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useInfinitePages } from '@iace/app-kit';
import { PageCrumbs, useFilterSpec } from '@iace/app-kit/browser';
import { BellOff, SearchX } from 'lucide-react';
import {
  Alert,
  Badge,
  Button,
  EmptyState,
  PageHeader,
  PanelFrame,
  Skeleton,
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
  NAV_ITEMS,
  NOTIFICATIONS_PAGE_SIZE,
  ROUTES,
  UNREAD_QUERY_KEY,
  notificationsQueryKey,
} from '../lib/constants';

const READ_STATE = { ALL: '', UNREAD: 'unread' } as const;

const SKELETON_KEYS = ['a', 'b', 'c', 'd'];

/** Half the row on screen is a read, not a row that clipped the edge of the viewport. */
const SEEN_RATIO = 0.5;

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

  // Paged, not pinned to the first: a student with thirty results must be able to reach the oldest.
  const list = useInfinitePages({
    queryKey: notificationsQueryKey(unreadOnly),
    fetchPage: (page) =>
      api.me.notifications({
        ...(unreadOnly ? { unreadOnly: 'true' } : {}),
        page,
        pageSize: NOTIFICATIONS_PAGE_SIZE,
      }),
  });

  return (
    <PanelFrame
      header={
        <PageHeader
          breadcrumbs={<PageCrumbs nav={NAV_ITEMS} />}
          title="Notifications"
          meta={plural(list.total, 'notification')}
        />
      }
      filters={{ spec: FILTERS, state: filters }}
      filtersBesideTitle
    >
      <FeedRegion list={list} rows={list.items} unreadOnly={unreadOnly} />
    </PanelFrame>
  );
}

/** Loading and failing are not "none yet", and a filtered empty is not an empty bell. */
function FeedRegion({
  list,
  rows,
  unreadOnly,
}: Readonly<{
  list: {
    isLoading: boolean;
    isError: boolean;
    isLoadingMore: boolean;
    hasMore: boolean;
    loadMore: () => void;
  };
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
    <div className="flex flex-col">
      {/* The rule is on the WRAPPER and full width; the row inside keeps its radius and its hover,
          so a hovered row cannot bend the line it sits above. */}
      <div className="flex flex-col divide-y divide-border">
        {rows.map((row) => (
          <div key={row.id} className="py-1">
            <NotificationRow notification={row} />
          </div>
        ))}
      </div>

      {list.hasMore ? (
        <Button
          variant="outline"
          className="mt-4 self-center"
          onClick={list.loadMore}
          disabled={list.isLoadingMore}
        >
          Show older
        </Button>
      ) : null}
    </div>
  );
}

/** A row in one panel, never its own card: a card inside the frame's card is a card in a card. */
function NotificationRow({ notification }: Readonly<{ notification: Notification }>) {
  const markRead = useMarkRead(notification);
  const { setNode, read: seen } = useSeen(notification.isRead, markRead);
  const destination = destinationOf(notification);
  const unread = !notification.isRead && !seen;

  return (
    <div
      ref={setNode}
      className="flex flex-wrap items-start gap-x-4 gap-y-3 rounded-md p-4 transition-colors hover:bg-muted/50"
    >
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex items-center gap-2">
          {unread ? <span aria-hidden className="size-2 shrink-0 rounded-full bg-primary" /> : null}
          <span className="font-medium">{notification.title}</span>
          <Badge variant={unread ? 'primary' : 'neutral'}>{TYPE_LABEL[notification.type]}</Badge>
        </span>
        {notification.body ? <span className="text-sm">{notification.body}</span> : null}
        <span className="text-xs text-muted-foreground">
          {whenItArrived(notification.createdAt)}
        </span>
      </span>

      {destination ? (
        <Button asChild size="sm" variant="outline" onClick={() => markRead()}>
          <Link to={destination.to}>{destination.label}</Link>
        </Button>
      ) : null}
    </div>
  );
}

/** Stable, so the observer below can depend on it without re-registering every render. */
function useMarkRead(notification: Notification) {
  const queryClient = useQueryClient();

  const { mutate } = useMutation({
    mutationFn: () => api.me.readNotification(notification.id),
    // The COUNT only: refetching the list would pull rows out from under the reader who marked them.
    onSettled: () => queryClient.invalidateQueries({ queryKey: UNREAD_QUERY_KEY }),
  });

  return React.useCallback(() => {
    if (!notification.isRead) mutate();
  }, [notification.isRead, mutate]);
}

/** Read is what a student has actually SEEN, so a row that reaches the viewport counts as read. */
function useSeen(isRead: boolean, markRead: () => void) {
  // A callback ref, not a ref object: the node arrives as state, so nothing is read during render.
  const [node, setNode] = React.useState<HTMLElement | null>(null);
  const [read, setRead] = React.useState(false);

  React.useEffect(() => {
    if (isRead || read || node === null || typeof IntersectionObserver === 'undefined') return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        setRead(true);
        markRead();
      },
      { threshold: SEEN_RATIO },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [isRead, read, node, markRead]);

  return { setNode, read };
}

/** The deep link the notification carries, or nothing — a notice opens no screen of its own. */
function destinationOf(notification: Notification): { to: string; label: string } | null {
  if (notification.testId) {
    return { to: ROUTES.TEST_ABOUT(notification.testId), label: 'Open test' };
  }
  if (notification.testSeriesId) {
    return { to: ROUTES.SERIES(notification.testSeriesId), label: 'Open series' };
  }
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
