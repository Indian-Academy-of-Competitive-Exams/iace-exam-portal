import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { type ListFilter } from '@iace/ui';
import { useScrollList } from '../browser/use-scroll-list';
import { useLocalFilters } from '../browser/use-local-filters';

/** gcTime 0 and an explicit clear: react-query's default 5-minute timer outlives the run. */
const client = new QueryClient({ defaultOptions: { queries: { gcTime: 0, retry: false } } });

afterEach(() => {
  cleanup();
  client.clear();
});

const FILTERS = [
  { key: 'q', kind: 'search', label: 'Search', primary: true },
] as const satisfies readonly ListFilter[];

const PAGE_SIZE = 2;
const TOTAL = 4;

function Probe({
  onReady,
}: Readonly<{ onReady: (list: ReturnType<typeof useScrollList>) => void }>) {
  const store = useLocalFilters();
  const list = useScrollList({
    queryKey: ['pool'],
    filters: FILTERS,
    store,
    toQuery: (values) => ({ q: values.q || undefined }),
    fetchPage: ({ page, q }) =>
      Promise.resolve({
        items: [`${q ?? 'all'}-${page}a`, `${q ?? 'all'}-${page}b`],
        total: TOTAL,
        page,
        pageSize: PAGE_SIZE,
      }),
  });

  onReady(list);
  return <p data-testid="rows">{list.rows.join(',')}</p>;
}

function mount() {
  let list: ReturnType<typeof useScrollList> | undefined;
  render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <Probe onReady={(next) => (list = next)} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
  return () => {
    assert.ok(list);
    return list;
  };
}

const rows = () => screen.getByTestId('rows').textContent ?? '';

describe('useScrollList', () => {
  it('keeps what it has and adds the next page under it', async () => {
    const list = mount();
    await waitFor(() => assert.equal(rows(), 'all-1a,all-1b'));

    list().scroll?.onLoadMore?.();

    await waitFor(() => assert.equal(rows(), 'all-1a,all-1b,all-2a,all-2b'));
  });

  it('stops asking once every page has arrived', async () => {
    const list = mount();
    await waitFor(() => assert.equal(list().scroll?.hasMore, true));

    list().scroll?.onLoadMore?.();

    await waitFor(() => assert.equal(list().scroll?.hasMore, false));
  });

  /** The failure this prevents: a narrowed pool appended to the rows of the wider one. */
  it('starts again when a filter changes rather than appending to the old pool', async () => {
    const list = mount();
    await waitFor(() => assert.equal(rows(), 'all-1a,all-1b'));
    list().scroll?.onLoadMore?.();
    await waitFor(() => assert.equal(rows(), 'all-1a,all-1b,all-2a,all-2b'));

    list().setFilter('q', 'percent');

    await waitFor(() => assert.equal(rows(), 'percent-1a,percent-1b'));
  });

  it('offers no pager at all — the rows are the whole control', () => {
    const list = mount();

    assert.equal(list().pagination, undefined);
  });
});
