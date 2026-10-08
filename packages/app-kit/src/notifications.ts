/** What a read notification does to the cache on both clients: counted down and marked where it sits. */
import { type InfiniteData, type QueryClient } from '@tanstack/react-query';
import { type Notification, type Paginated } from '@iace/contracts';
import { notificationsQueryKey, UNREAD_QUERY_KEY } from './student-queries';

/** Patched, never invalidated: a screenful of rows read at once is otherwise a GET per row plus the count. */
export function markNotificationRead(queryClient: QueryClient, notificationId: string): void {
  let wasUnread = false;
  // Marked in both lists, so the row reads as read and a second answer for it finds nothing to count.
  for (const unreadOnly of [true, false]) {
    queryClient.setQueryData<InfiniteData<Paginated<Notification>>>(
      notificationsQueryKey(unreadOnly),
      (lists) =>
        lists && {
          ...lists,
          pages: lists.pages.map((page) => ({
            ...page,
            items: page.items.map((row) => {
              if (row.id !== notificationId || row.isRead) return row;
              wasUnread = true;
              return { ...row, isRead: true };
            }),
          })),
        },
    );
  }
  if (!wasUnread) return;

  queryClient.setQueryData<Paginated<Notification>>(UNREAD_QUERY_KEY, (count) =>
    count ? { ...count, total: Math.max(0, count.total - 1) } : count,
  );
}
