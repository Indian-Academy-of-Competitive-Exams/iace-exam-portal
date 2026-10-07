import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import {
  ActorTypes,
  FEATURE_KEYS,
  PERMISSION_LEVELS,
  type AdminPermissions,
  type AuthTokens,
} from '@iace/contracts';
import { ThemeProvider, TooltipProvider } from '@iace/ui';
import './support/offline';
import { api, tokenStore } from '../src/lib/api';
import { ROUTES } from '../src/lib/constants';
import { AuthProvider } from '../src/providers/auth';
import { App } from '../src/App';

/** gcTime 0 and an explicit clear: react-query's default 5-minute timer outlives the run. */
const client = new QueryClient({ defaultOptions: { queries: { gcTime: 0, retry: false } } });

afterEach(() => {
  cleanup();
  client.clear();
  tokenStore.clear();
  mock.restoreAll();
});

/** jsdom has no matchMedia, and the shell and the theme both ask it on mount. */
window.matchMedia = ((query: string) => ({
  matches: true,
  media: query,
  addEventListener() {},
  removeEventListener() {},
})) as unknown as typeof window.matchMedia;

const REFUSAL = 'This screen is not open to you';
const EMPTY_PAGE = { items: [], page: 1, pageSize: 20, total: 0 };

/** The whole app at one address, signed in as an admin holding exactly these grants; hands back the page's own read. */
function open(path: string, permissions: AdminPermissions) {
  tokenStore.set({ accessToken: 'access', refreshToken: 'refresh' } as AuthTokens);
  mock.method(api.auth, 'me', () =>
    Promise.resolve({
      actor: ActorTypes.ADMIN,
      id: 'admin_1',
      email: 'ops@iace.co.in',
      fullName: null,
      isActive: true,
      isSuperAdmin: false,
      permissions,
    }),
  );
  mock.method(api.admin.liveOps, 'tests', () => Promise.resolve(EMPTY_PAGE));
  const board = mock.method(api.admin.liveOps, 'board', () => Promise.resolve(EMPTY_PAGE));

  render(
    <MemoryRouter initialEntries={[path]}>
      <QueryClientProvider client={client}>
        <ThemeProvider>
          <TooltipProvider>
            <AuthProvider>
              <App />
            </AuthProvider>
          </TooltipProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
  return board;
}

/** The failure this prevents: a typed address opening a screen whose every request the API refuses. */
describe('a screen behind a feature key', () => {
  it('is refused at the door, without its page, to an admin who lacks the key', async () => {
    const board = open(`${ROUTES.LIVE_OPS}?testId=test_1`, {
      [FEATURE_KEYS.TEST_MANAGEMENT]: PERMISSION_LEVELS.WRITE,
    });

    assert.ok(await screen.findByText(REFUSAL));
    assert.equal(screen.queryByRole('heading', { name: 'Sittings' }), null);
    assert.equal(board.mock.callCount(), 0);
  });

  it('opens as before for an admin who holds it', async () => {
    const board = open(`${ROUTES.LIVE_OPS}?testId=test_1`, {
      [FEATURE_KEYS.TEST_OPERATIONS]: PERMISSION_LEVELS.READ,
    });

    assert.ok(await screen.findByRole('heading', { name: 'Sittings' }));
    await waitFor(() => assert.equal(board.mock.callCount(), 1));
    assert.equal(screen.queryByText(REFUSAL), null);
  });

  it('refuses a write-only screen to a holder at READ', async () => {
    open(ROUTES.AUTHORING_EDITOR, { [FEATURE_KEYS.QUESTION_AUTHORING]: PERMISSION_LEVELS.READ });

    assert.ok(await screen.findByText(REFUSAL));
    assert.equal(screen.queryByRole('button', { name: /Save/ }), null);
  });
});
