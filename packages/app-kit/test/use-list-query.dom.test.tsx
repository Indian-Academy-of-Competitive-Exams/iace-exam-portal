import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { type ReactNode } from 'react';
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { useListQuery } from '../src/use-list-query';

/** Pages are kept here, since a page that emptied must still be in the cache to mislead; the clear below is what stops the timers. */
const client = new QueryClient({ defaultOptions: { queries: { gcTime: 60_000, retry: false } } });

afterEach(() => {
  cleanup();
  client.clear();
  onlineManager.setOnline(true);
});

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={client}>{children}</QueryClientProvider>
);

const KEY = ['saved'];
const PAGE_SIZE = 20;
const rowsUpTo = (count: number) => Array.from({ length: count }, (_, at) => `row-${at + 1}`);

/** A list served from rows the test can add to and take from, as a removal or a new save would. */
function listOf(count: number) {
  const server = { rows: rowsUpTo(count), asked: 0 };
  const view = renderHook(
    () =>
      useListQuery({
        queryKey: KEY,
        filters: {},
        fetchPage: ({ page, pageSize }) => {
          server.asked += 1;
          return Promise.resolve({
            items: server.rows.slice((page - 1) * pageSize, page * pageSize),
            total: server.rows.length,
            page,
            pageSize,
          });
        },
      }),
    { wrapper },
  );
  const serve = async (next: number) => {
    server.rows = rowsUpTo(next);
    await act(() => client.invalidateQueries({ queryKey: KEY }));
  };
  return { list: () => view.result.current, server, serve };
}

async function onItsSecondPage(count: number) {
  const held = listOf(count);
  await waitFor(() => assert.equal(held.list().items.length, PAGE_SIZE));
  act(() => held.list().setPage(2));
  await waitFor(() => assert.deepEqual(held.list().items, rowsUpTo(count).slice(PAGE_SIZE)));
  return held;
}

describe('useListQuery', () => {
  /** The failure this prevents: removing the only row of the last page leaves the list on "2 / 1" with nothing in it. */
  it('steps back to the last page that exists when the one it is on empties', async () => {
    const { list, serve } = await onItsSecondPage(PAGE_SIZE + 1);

    await serve(PAGE_SIZE);

    await waitFor(() => assert.equal(list().pagination.page, 1));
    assert.deepEqual(list().items, rowsUpTo(PAGE_SIZE));
    assert.equal(list().total, PAGE_SIZE);
  });

  /** The failure this prevents: the emptied page, still cached, bouncing the reader off a page that has rows again. */
  it('returns to that page once it holds rows again', async () => {
    const { list, serve } = await onItsSecondPage(PAGE_SIZE + 1);
    await serve(PAGE_SIZE);
    await waitFor(() => assert.equal(list().pagination.page, 1));

    await serve(PAGE_SIZE + 1);
    act(() => list().setPage(2));

    await waitFor(() => assert.deepEqual(list().items, [`row-${PAGE_SIZE + 1}`]));
    assert.equal(list().page, 2);
  });

  it('leaves a list with nothing in it where it is, asked for once', async () => {
    const { list, server } = listOf(0);

    await waitFor(() => assert.equal(list().hasLoaded, true));

    assert.deepEqual(list().items, []);
    assert.equal(list().page, 1);
    assert.equal(server.asked, 1);
  });

  /** The failure this prevents: "No students yet" over a list that was never read. */
  it('says a list it could not read offline did not load, and reads it once back online', async () => {
    onlineManager.setOnline(false);
    const { list } = listOf(3);

    assert.equal(list().isError, true);
    assert.equal(list().isLoading, false);

    act(() => onlineManager.setOnline(true));

    await waitFor(() => assert.equal(list().items.length, 3));
    assert.equal(list().isError, false);
  });

  /** The failure this prevents: the last filter's rows standing as the answer to this one. */
  it('drops the rows of the last filter when the next one cannot be read', async () => {
    const view = renderHook(
      ({ q }) =>
        useListQuery({
          queryKey: KEY,
          filters: { q },
          fetchPage: ({ q: asked, page, pageSize }) =>
            Promise.resolve({ items: [`${asked}-1`], total: 1, page, pageSize }),
        }),
      { wrapper, initialProps: { q: 'ssc' } },
    );
    await waitFor(() => assert.deepEqual(view.result.current.items, ['ssc-1']));

    onlineManager.setOnline(false);
    view.rerender({ q: 'rrb' });

    assert.deepEqual(view.result.current.items, []);
    assert.equal(view.result.current.isError, true);

    act(() => onlineManager.setOnline(true));

    await waitFor(() => assert.deepEqual(view.result.current.items, ['rrb-1']));
    assert.equal(view.result.current.isError, false);
  });
});
