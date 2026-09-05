import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { useImportScreen, type ImportScreenState } from '../browser/use-import-screen';

/** gcTime 0 and an explicit clear: react-query's default 5-minute timer outlives the run. */
const client = new QueryClient({
  defaultOptions: { queries: { gcTime: 0, retry: false }, mutations: { retry: false } },
});

afterEach(() => {
  cleanup();
  client.clear();
});

interface Plan {
  name: string;
  writes: number;
}

const fileNamed = (name: string) => new File(['mobile\n9000000000'], name);

function mount(
  overrides: Partial<Parameters<typeof useImportScreen<Plan, string>>[0]> = {},
): () => ImportScreenState<Plan, string> {
  let state: ImportScreenState<Plan, string> | undefined;

  function Probe() {
    state = useImportScreen<Plan, string>({
      preview: (file) => Promise.resolve({ name: file.name, writes: 2 }),
      commit: (_file, plan) => Promise.resolve(`committed ${plan.name}`),
      writes: (plan) => plan.writes,
      ...overrides,
    });
    return null;
  }

  render(
    <QueryClientProvider client={client}>
      <Probe />
    </QueryClientProvider>,
  );

  return () => {
    assert.ok(state);
    return state;
  };
}

describe('useImportScreen', () => {
  it('previews the file as soon as it is chosen, and counts what Import would write', async () => {
    const read = mount();

    await act(async () => read().choose(fileNamed('first.csv')));

    assert.equal(read().plan?.name, 'first.csv');
    assert.equal(read().writes, 2);
    assert.equal(read().canCommit, true);
  });

  it('drops the plan the moment a second file is chosen, so nothing commits a file nobody saw', async () => {
    const read = mount();

    await act(async () => read().choose(fileNamed('first.csv')));
    assert.equal(read().plan?.name, 'first.csv');

    // Synchronous on purpose: the old plan must not outlive the file for even one render.
    act(() => read().choose(fileNamed('second.csv')));
    assert.equal(read().plan, null);
    assert.equal(read().canCommit, false);

    await waitFor(() => assert.equal(read().plan?.name, 'second.csv'));
  });

  it('refuses a second commit of a run already committed', async () => {
    const read = mount();

    await act(async () => read().choose(fileNamed('first.csv')));
    assert.equal(read().canCommit, true);

    await act(async () => read().commit());
    await waitFor(() => assert.equal(read().result, 'committed first.csv'));

    assert.equal(read().canCommit, false);
  });

  it('refuses to commit a plan that would write nothing', async () => {
    const read = mount({ preview: (file) => Promise.resolve({ name: file.name, writes: 0 }) });

    await act(async () => read().choose(fileNamed('empty.csv')));

    assert.ok(read().plan);
    assert.equal(read().canCommit, false);
  });

  it('takes a plan from a source that is not a file, and commits it with no file', async () => {
    let sawFile: File | null | undefined;
    const read = mount({
      commit: (file, plan) => {
        sawFile = file;
        return Promise.resolve(`committed ${plan.name}`);
      },
    });

    act(() => read().stage(null, { name: 'portal', writes: 5 }));
    assert.equal(read().writes, 5);
    assert.equal(read().canCommit, true);

    await act(async () => read().commit());
    await waitFor(() => assert.equal(read().result, 'committed portal'));

    assert.equal(sawFile, null);
  });
});
