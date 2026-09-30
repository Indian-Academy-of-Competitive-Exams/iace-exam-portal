import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  TEST_SERIES_KIND,
  type TestSeriesDetail,
  type UpdateTestSeriesInput,
} from '@iace/contracts';
import { TooltipProvider } from '@iace/ui';
import './support/offline';
import { api } from '../src/lib/api';
import { AuthProvider } from '../src/providers/auth';
import { TestSeriesFormPage } from '../src/features/test-series/test-series-form';

/** gcTime 0 and an explicit clear: react-query's default 5-minute timer outlives the run, on a finished mutation as much as on a query. */
const client = new QueryClient({
  defaultOptions: { queries: { gcTime: 0, retry: false }, mutations: { gcTime: 0 } },
});

afterEach(() => {
  cleanup();
  client.clear();
  mock.restoreAll();
});

const SERIES_ID = 'ser_1';
const FIRST_NAME = 'SSC CGL Tier 1 Mock Test Series';
const SAVED_NAME = 'SSC CGL Tier 2 Mock Test Series';

const SERIES: TestSeriesDetail = {
  id: SERIES_ID,
  name: FIRST_NAME,
  examStageId: null,
  programCode: null,
  sequentialTests: false,
  kind: TEST_SERIES_KIND.STANDARD,
  branchIds: [],
  isEnabled: false,
  eventId: null,
  createdAt: '2026-09-01T00:00:00.000Z',
  examStage: null,
  testCount: 0,
  enabledBranchCount: 0,
  branchCount: 0,
  reachedCount: 0,
  satCount: 0,
};

/** The server answers a save with the record it wrote, which is what the form must re-baseline on. */
function serverThatEchoes() {
  mock.method(api.admin.testSeries, 'detail', () => Promise.resolve(SERIES));
  return mock.method(api.admin.testSeries, 'update', (_id: string, body: UpdateTestSeriesInput) =>
    Promise.resolve({ ...SERIES, ...body }),
  );
}

function mount() {
  render(
    <MemoryRouter initialEntries={[`/tests/series/${SERIES_ID}`]}>
      <QueryClientProvider client={client}>
        <AuthProvider>
          <TooltipProvider>
            <Routes>
              <Route path="/tests/series/:id" element={<TestSeriesFormPage />} />
            </Routes>
          </TooltipProvider>
        </AuthProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

const nameField = () => screen.getByLabelText('Name') as HTMLInputElement;

const click = (name: string) => fireEvent.click(screen.getByRole('button', { name }));

/** The failure this prevents: a save silently undone by the next one, since bodyOf posts every field. */
describe('a saved test series', () => {
  it('is what Cancel returns to, and what the next save posts', async () => {
    const update = serverThatEchoes();

    mount();
    await waitFor(() => assert.equal(nameField().value, FIRST_NAME));

    click('Edit series');
    fireEvent.change(nameField(), { target: { value: SAVED_NAME } });
    click('Save series');
    await screen.findByRole('button', { name: 'Edit series' });
    assert.equal(nameField().value, SAVED_NAME);

    click('Edit series');
    click('Cancel');
    assert.equal(nameField().value, SAVED_NAME);

    click('Edit series');
    click('Save series');
    await waitFor(() => assert.equal(update.mock.callCount(), 2));
    assert.equal(update.mock.calls.at(-1)?.arguments[1].name, SAVED_NAME);
  });
});
