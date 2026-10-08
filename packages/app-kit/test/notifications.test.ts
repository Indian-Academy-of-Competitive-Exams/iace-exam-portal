import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { QueryClient, type InfiniteData } from '@tanstack/react-query';
import { type Notification, type Paginated } from '@iace/contracts';
import { markNotificationRead } from '../src/notifications';
import { notificationsQueryKey, UNREAD_QUERY_KEY } from '../src/student-queries';

const page = (items: Notification[], total: number): Paginated<Notification> => ({
  items,
  total,
  page: 1,
  pageSize: 20,
});

const row = (id: string, isRead = false) => ({ id, isRead }) as Notification;

/** A bell showing `unread` waiting, over a list holding those rows and one already read. */
function bellHolding(unread: string[]) {
  // Never collected: a finite gcTime leaves a timer that keeps the run alive.
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
  const rows = [...unread.map((id) => row(id)), row('old', true)];
  client.setQueryData(UNREAD_QUERY_KEY, page([], unread.length));
  for (const unreadOnly of [true, false]) {
    client.setQueryData<InfiniteData<Paginated<Notification>>>(notificationsQueryKey(unreadOnly), {
      pages: [page(unreadOnly ? rows.filter((one) => !one.isRead) : rows, rows.length)],
      pageParams: [1],
    });
  }
  return {
    client,
    waiting: () => client.getQueryData<Paginated<Notification>>(UNREAD_QUERY_KEY)?.total,
    isRead: (id: string) =>
      client
        .getQueryData<InfiniteData<Paginated<Notification>>>(notificationsQueryKey(false))
        ?.pages[0]?.items.find((one) => one.id === id)?.isRead,
  };
}

describe('markNotificationRead', () => {
  it('counts each notification read down once, and marks it where it sits', () => {
    const bell = bellHolding(['a', 'b']);

    markNotificationRead(bell.client, 'a');
    markNotificationRead(bell.client, 'b');

    assert.equal(bell.waiting(), 0);
    assert.equal(bell.isRead('a'), true);
    assert.equal(bell.isRead('b'), true);
  });

  /** The failure this prevents: a double tap sending two reads, and each answer taking one off the badge. */
  it('counts a notification down once however many reads of it are answered', () => {
    const bell = bellHolding(['a', 'b']);

    markNotificationRead(bell.client, 'a');
    markNotificationRead(bell.client, 'a');

    assert.equal(bell.waiting(), 1);
  });

  it('leaves the count alone for a notification already read', () => {
    const bell = bellHolding(['a']);

    markNotificationRead(bell.client, 'old');

    assert.equal(bell.waiting(), 1);
  });
});
