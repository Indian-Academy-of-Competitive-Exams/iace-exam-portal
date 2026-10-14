import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { type ReactNode } from 'react';
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { type Paginated } from '@iace/contracts';
import { usePagedPicker, type PickerPageParams } from '../src/use-infinite-pages';

/** gcTime 0 and an explicit clear: react-query's default 5-minute timer outlives the run. */
const client = new QueryClient({ defaultOptions: { queries: { gcTime: 0, retry: false } } });

afterEach(() => {
  cleanup();
  client.clear();
  onlineManager.setOnline(true);
});

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={client}>{children}</QueryClientProvider>
);

describe('usePagedPicker', () => {
  /** The failure this prevents: every keystroke's search still downloading after the next one. */
  it('aborts the search the next keystroke replaced', async () => {
    const asked: PickerPageParams[] = [];
    const { result } = renderHook(
      () =>
        usePagedPicker({
          queryKey: ['picker'],
          fetchPage: (params) => {
            asked.push(params);
            return new Promise<Paginated<string>>(() => undefined);
          },
        }),
      { wrapper },
    );
    await waitFor(() => assert.equal(asked.length, 1));

    act(() => result.current.paging.onSearchChange('ssc'));

    await waitFor(() => assert.equal(asked.length, 2));
    assert.equal(asked[0]?.signal?.aborted, true, 'the search nobody is waiting for is stopped');
    assert.equal(asked[1]?.signal?.aborted, false);
    assert.equal(asked[1]?.q, 'ssc');
  });

  /** The failure this prevents: a picker opened offline drawing its skeleton until the page is reloaded. */
  it('says a list it could not read offline did not load, and reads it once back online', async () => {
    onlineManager.setOnline(false);
    const { result } = renderHook(
      () =>
        usePagedPicker({
          queryKey: ['picker'],
          fetchPage: ({ page, pageSize }) =>
            Promise.resolve({ items: ['ssc'], total: 1, page, pageSize }),
        }),
      { wrapper },
    );

    assert.equal(result.current.paging.isLoading, false);
    assert.equal(result.current.paging.isError, true);

    act(() => onlineManager.setOnline(true));

    await waitFor(() => assert.deepEqual(result.current.items, ['ssc']));
    assert.equal(result.current.paging.isError, false);
  });

  /** THE failure this prevents: a value read from the URL, on no loaded page, shown as its raw id. */
  it('fetches a chosen value no loaded page holds, by id, and leaves a loaded one alone', async () => {
    const rows = [
      { id: 'sub_1', name: 'Reasoning' },
      { id: 'sub_9', name: 'Quant' },
    ];
    const asked: PickerPageParams[] = [];
    const { result } = renderHook(
      () =>
        usePagedPicker({
          queryKey: ['subjects'],
          chosen: ['sub_1', 'sub_9'],
          fetchPage: (params) => {
            asked.push(params);
            const items = params.id
              ? rows.filter((row) => params.id?.includes(row.id))
              : [rows[0]!];
            return Promise.resolve({ items, total: items.length, page: 1, pageSize: 100 });
          },
        }),
      { wrapper },
    );

    await waitFor(() => assert.deepEqual(result.current.chosen, [rows[1]]));
    assert.deepEqual(
      asked.filter((params) => params.id).map((params) => params.id),
      [['sub_9']],
    );
  });
});
