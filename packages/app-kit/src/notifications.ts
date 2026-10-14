/** What a read notification does to the cache on both clients: counted down and marked where it sits. */
import { type InfiniteData, type QueryClient } from '@tanstack/react-query';
import { type Notification, type Paginated } from '@iace/contracts';
import { NOTIFICATION_LISTS_QUERY_KEY, UNREAD_QUERY_KEY } from './student-queries';

type HeldList = Paginated<Notification> | InfiniteData<Paginated<Notification>>;

/** Patched, never invalidated: a screenful of rows read at once is otherwise a GET per row plus the count. */
export function markNotificationRead(queryClient: QueryClient, notificationId: string): void {
  let wasUnread = false;
  const marked = (page: Paginated<Notification>): Paginated<Notification> => ({
    ...page,
    items: page.items.map((row) => {
      if (row.id !== notificationId || row.isRead) return row;
      wasUnread = true;
      return { ...row, isRead: true };
    }),
  });

  // Every list held, paged on the web and endless on the phone, so the row reads as read wherever it sits.
  queryClient.setQueriesData<HeldList>({ queryKey: NOTIFICATION_LISTS_QUERY_KEY }, (held) => {
    if (!held) return held;
    return 'pages' in held ? { ...held, pages: held.pages.map(marked) } : marked(held);
  });
  if (!wasUnread) return;

  queryClient.setQueryData<Paginated<Notification>>(UNREAD_QUERY_KEY, (count) =>
    count ? { ...count, total: Math.max(0, count.total - 1) } : count,
  );
}
