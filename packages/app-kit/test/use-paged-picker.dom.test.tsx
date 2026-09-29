import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { type Paginated } from '@iace/contracts';
import { usePagedPicker, type PickerPageParams } from '../src/use-infinite-pages';

/** gcTime 0 and an explicit clear: react-query's default 5-minute timer outlives the run. */
const client = new QueryClient({ defaultOptions: { queries: { gcTime: 0, retry: false } } });

afterEach(() => {
  cleanup();
  client.clear();
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
});
