import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AppException, ErrorCodes, type TicketDetail } from '@iace/contracts';
import { ThemeProvider, TooltipProvider } from '@iace/ui';
import './support/offline';
import { api } from '../src/lib/api';
import { ROUTES } from '../src/lib/constants';
import { QueryThreadPage } from '../src/features/support/query-thread';

/** gcTime 0 on both: a mutation's default 5-minute timer keeps the run alive after it passes. */
const client = new QueryClient({
  defaultOptions: { queries: { gcTime: 0, retry: false }, mutations: { gcTime: 0 } },
});

afterEach(() => {
  cleanup();
  client.clear();
  mock.restoreAll();
});

const TICKET: TicketDetail = {
  id: '00000000-0000-4000-8000-000000000001',
  category: 'OTHER',
  status: 'ANSWERED',
  lastMessageAt: '2026-10-16T05:00:00.000Z',
  createdAt: '2026-10-16T04:00:00.000Z',
  attemptId: null,
  messages: [],
};

function mount() {
  render(
    <MemoryRouter initialEntries={[ROUTES.HELP_QUERY(TICKET.id)]}>
      <QueryClientProvider client={client}>
        <ThemeProvider>
          <TooltipProvider>
            <Routes>
              <Route path={ROUTES.HELP_QUERY_PATTERN} element={<QueryThreadPage />} />
            </Routes>
          </TooltipProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('a query thread', () => {
  /** The failure this prevents: a header still offering Close on a query the server already closed. */
  it('refetches after a reply is refused as closed, and keeps the words in the box', async () => {
    let status: TicketDetail['status'] = 'ANSWERED';
    const detail = mock.method(api.me.support, 'detail', () =>
      Promise.resolve({ ...TICKET, status }),
    );
    mock.method(api.me.support, 'reply', () => {
      status = 'CLOSED';
      return Promise.reject(new AppException(ErrorCodes.TICKET_CLOSED));
    });
    mount();

    fireEvent.change(await screen.findByLabelText('Write a reply'), {
      target: { value: 'Still stuck' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => assert.equal(detail.mock.callCount(), 2));
    await waitFor(() => assert.equal(screen.queryByRole('button', { name: 'Close query' }), null));
    assert.equal(
      (screen.getByLabelText('Write a reply') as HTMLTextAreaElement).value,
      'Still stuck',
    );
  });
});
