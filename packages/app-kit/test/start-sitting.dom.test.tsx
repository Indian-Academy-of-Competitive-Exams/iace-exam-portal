import test from 'node:test';
import assert from 'node:assert/strict';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LANGUAGE_CODE, LANGUAGE_MODE, type LanguageCode } from '@iace/contracts';
import { beginChoice, useStartedSitting } from '../src/exam/start-sitting';
import type { AppApiClient } from '../src';
import { startedAttemptQueryKey } from '../src/student-queries';

const { EN, HI } = LANGUAGE_CODE;
const single = (languages: LanguageCode[]) => ({ languageMode: LANGUAGE_MODE.SINGLE, languages });

test('a paper in one language arrives chosen, and begins in it once declared', () => {
  const choice = beginChoice(single([EN]), '', true);
  assert.equal(choice.ready, true);
  assert.deepEqual(choice.languages, [EN]);
});

/** The failure this prevents: a paper started in a language nobody picked. */
test('a paper in two languages waits for a pick, then begins in that one only', () => {
  assert.equal(beginChoice(single([EN, HI]), '', true).ready, false);
  const picked = beginChoice(single([EN, HI]), HI, true);
  assert.equal(picked.ready, true);
  assert.deepEqual(picked.languages, [HI]);
});

test('a dual paper has nothing to pick and begins in every language it shows', () => {
  const choice = beginChoice({ languageMode: LANGUAGE_MODE.DUAL, languages: [EN, HI] }, '', true);
  assert.equal(choice.dual, true);
  assert.equal(choice.ready, true);
  assert.deepEqual(choice.languages, [EN, HI]);
});

test('nothing begins before the declaration', () => {
  assert.equal(beginChoice(single([EN]), EN, false).ready, false);
});

/** The failure this prevents: StrictMode's rehearsal unmount forgetting a start in the air, so it is sent twice. */
test('a sitting is started once, though StrictMode unmounts and remounts the screen', async (t) => {
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: 0, retry: false } } });
  let starts = 0;
  const api = {
    me: {
      startAttempt: () => {
        starts += 1;
        return new Promise(() => undefined);
      },
    },
  } as unknown as AppApiClient;
  const { unmount } = renderHook(() => useStartedSitting(api, 'test-1', { tab: 'tab-1' }), {
    reactStrictMode: true,
    wrapper: ({ children }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
  t.after(unmount);
  await act(async () => {
    await Promise.resolve();
  });

  assert.equal(starts, 1);
});

test('a sitting that started is forgotten when its screen goes, so a re-sit starts afresh', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: 0, retry: false } } });
  const api = {
    me: {
      startAttempt: async () => ({ id: 'attempt-1', paper: null }),
      attemptPaper: () => new Promise(() => undefined),
    },
  } as unknown as AppApiClient;
  const { unmount } = renderHook(() => useStartedSitting(api, 'test-1', { tab: 'tab-1' }), {
    wrapper: ({ children }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
  await act(async () => {
    await Promise.resolve();
  });
  assert.notEqual(client.getQueryData(startedAttemptQueryKey('test-1')), undefined);

  unmount();
  assert.equal(client.getQueryData(startedAttemptQueryKey('test-1')), undefined);
});
