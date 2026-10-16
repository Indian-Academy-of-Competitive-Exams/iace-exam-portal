/**
 * The student's bell. A DELIBERATE deviation from the list-screen convention, for the same reason
 * `tests.tsx` gives: this is something a student reads, not an admin data table, so it is a feed
 * parted by hairlines inside one panel rather than a ListView.
 */
import * as React from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  markNotificationRead,
  NOTIFICATION_FILTERS,
  notificationKindOf,
  notificationQuery,
} from '@iace/app-kit';
import { PageCrumbs, useListScreen } from '@iace/app-kit/browser';
import { Settings } from 'lucide-react';
import {
  Badge,
  Button,
  EmptyState,
  EMPTY_STATE_KINDS,
  FILLS,
  PageHeader,
  Pagination,
  PanelFrame,
  Skeleton,
  plural,
  type ListFilter,
} from '@iace/ui';
import { instituteDateTimeLabel, type Notification } from '@iace/contracts';
import { api } from '../../lib/api';
import {
  NAV_ITEMS,
  NOTIFICATION_LISTS_QUERY_KEY,
  ROUTES,
  UNREAD_QUERY_KEY,
} from '../../lib/constants';

const SKELETON_KEYS = ['a', 'b', 'c', 'd'];

/** Half the row on screen is a read, not a row that clipped the edge of the viewport. */
const SEEN_RATIO = 0.5;

const FILTERS = NOTIFICATION_FILTERS as ListFilter[];

export function NotificationsPage() {
  // Fixed for the visit: a row read on page one still counts as unread, so page two starts where it should.
  const [openedAt] = React.useState(() => new Date().toISOString());

  const list = useListScreen({
    queryKey: NOTIFICATION_LISTS_QUERY_KEY,
    filters: FILTERS,
    toQuery: (values) => notificationQuery(values, openedAt),
    fetchPage: (params) => api.me.notifications(params),
  });

  return (
    <PanelFrame
      fills
      header={
        <PageHeader
          breadcrumbs={<PageCrumbs nav={NAV_ITEMS} />}
          title="Notifications"
          meta={plural(list.total, 'notification')}
          action={
            <Button asChild variant="outline" size="sm">
              <Link to={ROUTES.NOTIFICATION_SETTINGS}>
                <Settings />
                Settings
              </Link>
            </Button>
          }
        />
      }
      // No All/Any choice: the bell's filters always narrow together.
      filters={{ spec: FILTERS, state: { ...list, matchAny: undefined, setMatchAny: undefined } }}
    >
      <div className={FILLS}>
        <div className="relative min-h-0 flex-1 overflow-y-auto">
          <FeedRegion list={list} filtered={isFiltered(list.values)} />
        </div>
        {list.hasLoaded && list.total > 0 ? (
          <div className="shrink-0 pt-4">
            <Pagination {...list.pagination} />
          </div>
        ) : null}
      </div>
    </PanelFrame>
  );
}

/** Loading and failing are not "none yet", and a filtered empty is not an empty bell. */
function FeedRegion({
  list,
  filtered,
}: Readonly<{
  filtered: boolean;
  list: {
    rows: readonly Notification[];
    isLoading: boolean;
    isError?: boolean;
    retry?: () => void;
  };
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
  if (list.isError && list.rows.length === 0) {
    return (
      <EmptyState
        kind={EMPTY_STATE_KINDS.FAILURE}
        title="Your notifications did not load"
        onRetry={list.retry}
      />
    );
  }
  if (list.rows.length === 0) {
    return filtered ? (
      <EmptyState kind={EMPTY_STATE_KINDS.FILTERED} title="Nothing matches" />
    ) : (
      <EmptyState title="No notifications yet" />
    );
  }

  return (
    // The rule is on the wrapper and full width, so a hovered row cannot bend the line it sits above.
    <div className="flex flex-col divide-y divide-border">
      {list.rows.map((row) => (
        <div key={row.id} className="py-1">
          <NotificationRow notification={row} />
        </div>
      ))}
    </div>
  );
}

const isFiltered = (values: object): boolean =>
  Object.values(values).some((value) => (Array.isArray(value) ? value.length > 0 : Boolean(value)));

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
      <span className="flex min-w-0 flex-1 flex-col gap-1 max-sm:basis-full">
        <span className="flex flex-wrap items-center gap-2">
          {unread ? <span aria-hidden className="size-2 shrink-0 rounded-full bg-primary" /> : null}
          <span className="font-medium">{notification.title}</span>
          <Badge variant={unread ? 'primary' : 'neutral'}>
            {notificationKindOf(notification.type)}
          </Badge>
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

  const { mutate, isPending } = useMutation({
    mutationFn: () => api.me.readNotification(notification.id),
    onSuccess: () => markNotificationRead(queryClient, notification.id),
    onError: () => void queryClient.invalidateQueries({ queryKey: UNREAD_QUERY_KEY }),
  });

  return React.useCallback(() => {
    if (!notification.isRead && !isPending) mutate();
  }, [notification.isRead, isPending, mutate]);
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
  if (notification.ticketId) {
    return { to: ROUTES.HELP_QUERY(notification.ticketId), label: 'Open query' };
  }
  if (notification.testSeriesId) {
    return { to: ROUTES.SERIES(notification.testSeriesId), label: 'Open series' };
  }
  return null;
}

/** The institute's clock, never the device's — a student in another zone reads the same day. */
function whenItArrived(at: string): string {
  return instituteDateTimeLabel(at);
}
