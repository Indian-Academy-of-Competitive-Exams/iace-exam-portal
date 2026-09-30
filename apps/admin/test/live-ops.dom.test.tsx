import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { AppException, ErrorCodes } from '@iace/contracts';
import { TooltipProvider } from '@iace/ui';
import { TourProvider } from '@iace/app-kit/browser';
import './support/offline';
import { api } from '../src/lib/api';
import { AuthProvider } from '../src/providers/auth';
import { LiveOpsPage } from '../src/features/live-ops/live-ops';

/** gcTime 0 and an explicit clear: react-query's default 5-minute timer outlives the run. */
const client = new QueryClient({ defaultOptions: { queries: { gcTime: 0, retry: false } } });

afterEach(() => {
  cleanup();
  client.clear();
  mock.restoreAll();
});

const OUTAGE = new AppException(ErrorCodes.INTERNAL, 'boom', { httpStatus: 500 });

const EMPTY_PAGE = { items: [], page: 1, pageSize: 20, total: 0 };

function mount() {
  render(
    <MemoryRouter initialEntries={['/live-ops?testId=test_1']}>
      <QueryClientProvider client={client}>
        <AuthProvider>
          <TooltipProvider>
            <TourProvider storage={localStorage} storageKey="admin.tours">
              <LiveOpsPage />
            </TourProvider>
          </TooltipProvider>
        </AuthProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

/** The failure this prevents: an outage reading as a hall nobody turned up to. */
describe('the sittings board during an outage', () => {
  it('says the read failed and asks again when told to, not that the hall is empty', async () => {
    mock.method(api.admin.liveOps, 'tests', () => Promise.resolve(EMPTY_PAGE));
    const board = mock.method(api.admin.liveOps, 'board', () => Promise.reject(OUTAGE));

    mount();

    assert.ok(await screen.findByText('Could not load this list.'));
    assert.equal(screen.queryByText('Nobody is sitting this test right now'), null);

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    assert.equal(board.mock.callCount(), 2);
  });
});
