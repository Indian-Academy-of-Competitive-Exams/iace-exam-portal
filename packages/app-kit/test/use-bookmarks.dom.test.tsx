import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { type AppApiClient } from '../src';
import { useBookmarks } from '../src/review';

/** Nothing kept and nothing retried, mutations included: a real client's timers outlive the run. */
const client = new QueryClient({
  defaultOptions: { queries: { gcTime: 0, retry: false }, mutations: { gcTime: 0 } },
});

afterEach(() => {
  cleanup();
  client.clear();
});

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={client}>{children}</QueryClientProvider>
);

const ATTEMPT = 'attempt_1';
const QUESTION = 'question_1';
const SAVED = { questionId: QUESTION, savedId: 'saved_1' };

/** The server's list of stars, and a toggle that either lands on it or is refused. */
function starsHeldAs(held: (typeof SAVED)[]) {
  const server = { held };
  const api = {
    me: {
      bookmarksInAttempt: () => Promise.resolve({ attemptId: ATTEMPT, bookmarks: server.held }),
      bookmarkQuestion: () => {
        server.held = [SAVED];
        return Promise.resolve(SAVED);
      },
      removeSavedQuestion: (savedId: string) =>
        server.held.some((row) => row.savedId === savedId)
          ? Promise.resolve(null)
          : Promise.reject(new Error('That saved question is gone.')),
    },
  } as unknown as AppApiClient;
  return { api, server };
}

describe('useBookmarks', () => {
  it('reads the star back once a toggle lands', async () => {
    const { api } = starsHeldAs([]);
    const { result } = renderHook(() => useBookmarks(api, ATTEMPT), { wrapper });
    await waitFor(() => assert.equal(result.current.saved.has(QUESTION), false));

    act(() => result.current.onToggle(QUESTION));

    await waitFor(() => assert.equal(result.current.saved.has(QUESTION), true));
  });

  /** The failure this prevents: a star removed on another client still reading as saved after the tap was refused. */
  it('reads the star back when the toggle is refused, rather than keeping what it last knew', async () => {
    const { api, server } = starsHeldAs([SAVED]);
    const { result } = renderHook(() => useBookmarks(api, ATTEMPT), { wrapper });
    await waitFor(() => assert.equal(result.current.saved.has(QUESTION), true));

    server.held = [];
    act(() => result.current.onToggle(QUESTION));

    await waitFor(() => assert.equal(result.current.saved.has(QUESTION), false));
    assert.equal(result.current.pendingId, null);
  });
});
