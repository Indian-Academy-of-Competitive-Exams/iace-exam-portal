import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { MemoryRouter, useSearchParams } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { type ListFilter } from '@iace/ui';
import { useListScreen } from '../browser/use-list-screen';
import { useLocalFilters } from '../browser/use-local-filters';

/** gcTime 0 and an explicit clear: react-query's default 5-minute timer outlives the run. */
const client = new QueryClient({ defaultOptions: { queries: { gcTime: 0, retry: false } } });

afterEach(() => {
  cleanup();
  client.clear();
});

const FILTERS = [
  { key: 'q', kind: 'search', label: 'Search', primary: true },
  { key: 'subjectId', kind: 'choice', label: 'Subject', items: [] },
  { key: 'difficulty', kind: 'multi', label: 'Difficulty', items: [] },
] as const satisfies readonly ListFilter[];

const page = { items: [], total: 0, page: 1, pageSize: 20 };

function Probe({
  onReady,
}: Readonly<{ onReady: (list: ReturnType<typeof useListScreen>) => void }>) {
  const [params] = useSearchParams();
  const list = useListScreen({
    queryKey: ['topics'],
    filters: FILTERS,
    toQuery: (values) => ({ q: values.q || undefined }),
    fetchPage: () => Promise.resolve(page),
  });

  onReady(list);
  return <p data-testid="url">{params.toString()}</p>;
}

function mount(search: string) {
  let list: ReturnType<typeof useListScreen> | undefined;
  render(
    <MemoryRouter initialEntries={[`/taxonomy?${search}`]}>
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

const url = () => screen.getByTestId('url').textContent ?? '';

describe('useListScreen', () => {
  it('reads its values from the URL, so a link into a screen and its controls agree', () => {
    const list = mount('q=percent&subjectId=sub_1&level=topics');

    assert.equal(list().values.q, 'percent');
    assert.equal(list().values.subjectId, 'sub_1');
  });

  it('leaves a key it does not own alone when clearing', async () => {
    // The Topics tab lives in `level`; clearing used to wipe it and land on Subjects.
    const list = mount('q=percent&subjectId=sub_1&level=topics');

    list().clearFilters();

    await waitFor(() => assert.equal(url(), 'level=topics'));
  });

  it('drops every one of its own keys when clearing, not just the visible one', async () => {
    const list = mount('q=percent&subjectId=sub_1');

    list().clearFilters();

    await waitFor(() => assert.equal(url(), ''));
  });

  it('writes one filter without disturbing the others', async () => {
    const list = mount('level=topics');

    list().setFilter('q', 'ratio');

    await waitFor(() => assert.equal(new URLSearchParams(url()).get('q'), 'ratio'));
    assert.equal(new URLSearchParams(url()).get('level'), 'topics');
  });
});

/** CSV on the wire, a set in the screen. Both directions, because either alone is a silent bug. */
describe('useListScreen — a multi filter', () => {
  it('reads a CSV param as a set', () => {
    const list = mount('difficulty=LOW,HIGH');

    assert.deepEqual(list().values.difficulty, ['LOW', 'HIGH']);
  });

  it('reads a missing param as an empty set, not undefined', () => {
    const list = mount('');

    assert.deepEqual(list().values.difficulty, []);
  });

  it('writes a set back as CSV', async () => {
    const list = mount('');

    list().setFilter('difficulty', ['LOW', 'HIGH']);

    await waitFor(() => assert.equal(new URLSearchParams(url()).get('difficulty'), 'LOW,HIGH'));
  });

  it('drops the param when the last one is unchosen', async () => {
    const list = mount('difficulty=LOW');

    list().setFilter('difficulty', []);

    await waitFor(() => assert.equal(url(), ''));
  });

  it('leaves the single-value filters as strings', () => {
    const list = mount('q=ratio&difficulty=LOW');

    assert.equal(list().values.q, 'ratio');
    assert.deepEqual(list().values.difficulty, ['LOW']);
  });
});

/** The toggle is a filter like any other: it lives in the URL, so a link carries it. */
describe('useListScreen — matching all or any', () => {
  it('narrows by default, with nothing in the URL to say so', () => {
    const list = mount('');

    assert.equal(list().matchAny, false);
  });

  it('reads the widened mode from the URL', () => {
    const list = mount('match=any');

    assert.equal(list().matchAny, true);
  });

  it('writes the mode, and drops it again rather than spelling out the default', async () => {
    const list = mount('q=ratio');

    list().setMatchAny?.(true);
    await waitFor(() => assert.equal(new URLSearchParams(url()).get('match'), 'any'));

    list().setMatchAny?.(false);
    await waitFor(() => assert.equal(new URLSearchParams(url()).get('match'), null));
  });

  /** Clearing the filters clears how they were being combined — it governed nothing else. */
  it('drops the mode when the filters are cleared', async () => {
    const list = mount('q=ratio&match=any&level=topics');

    list().clearFilters();

    await waitFor(() => assert.equal(url(), 'level=topics'));
  });
});

function LocalProbe({
  onReady,
}: Readonly<{ onReady: (list: ReturnType<typeof useListScreen>) => void }>) {
  const [params] = useSearchParams();
  const list = useListScreen({
    queryKey: ['topics'],
    filters: FILTERS,
    toQuery: (values) => ({ q: values.q || undefined }),
    fetchPage: () => Promise.resolve(page),
    store: useLocalFilters(),
  });

  onReady(list);
  return <p data-testid="url">{params.toString()}</p>;
}

describe('useListScreen — filters that are nobody\u2019s link', () => {
  function mountLocal() {
    let list: ReturnType<typeof useListScreen> | undefined;
    render(
      <MemoryRouter initialEntries={['/pick']}>
        <QueryClientProvider client={client}>
          <LocalProbe onReady={(next) => (list = next)} />
        </QueryClientProvider>
      </MemoryRouter>,
    );
    return () => {
      assert.ok(list);
      return list;
    };
  }

  /** The failure this prevents: one section's topic filter surviving into the next section's. */
  it('narrows and clears without touching the address bar', () => {
    const list = mountLocal();

    act(() => list().setFilter('q', 'percentages'));
    assert.equal(list().values.q, 'percentages');
    assert.equal(url(), '');

    act(() => list().clearFilters());
    assert.equal(list().values.q, '');
    assert.equal(url(), '');
  });

  it('reads a set back as a set, exactly as the URL one does', () => {
    const list = mountLocal();

    act(() => list().setFilter('difficulty', ['EASY', 'HARD']));

    assert.deepEqual(list().values.difficulty, ['EASY', 'HARD']);
  });
});
