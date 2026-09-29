import test from 'node:test';
import assert from 'node:assert/strict';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LANGUAGE_CODE, LANGUAGE_MODE, type LanguageCode } from '@iace/contracts';
import { beginChoice, useStartedSitting } from '../src/exam/start-sitting';
import type { AppApiClient } from '../src';
import { startedAttemptQueryKey, testPaperQueryKey } from '../src/student-queries';

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

/** The app's own cache lifetime, so what is dropped at unmount is dropped by the hook, not by the test's client. */
function mountedStart(api: AppApiClient, t: { after: (fn: () => void) => void }, strict = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  t.after(() => client.clear());
  const mounted = renderHook(() => useStartedSitting(api, 'test-1', { tab: 'tab-1' }), {
    reactStrictMode: strict,
    wrapper: ({ children }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
  return { client, ...mounted };
}

const nextTick = () => new Promise((resolve) => setTimeout(resolve, 0));

/** The failure this prevents: StrictMode's rehearsal unmount dropping a start in the air, so it is sent twice. */
test('a sitting is started once, though StrictMode unmounts and remounts the screen', async (t) => {
  let starts = 0;
  const api = {
    me: {
      startAttempt: () => {
        starts += 1;
        return new Promise(() => undefined);
      },
    },
  } as unknown as AppApiClient;
  const { unmount } = mountedStart(api, t, true);
  t.after(unmount);
  await act(nextTick);

  assert.equal(starts, 1);
});

test('a sitting that started is dropped when its screen goes, so a re-sit starts afresh', async (t) => {
  const api = {
    me: {
      startAttempt: async () => ({ id: 'attempt-1', paper: null }),
      attemptPaper: () => new Promise(() => undefined),
    },
  } as unknown as AppApiClient;
  const { client, unmount } = mountedStart(api, t);
  await act(nextTick);
  assert.notEqual(client.getQueryData(startedAttemptQueryKey('test-1')), undefined);

  unmount();
  await nextTick();
  assert.equal(client.getQueryData(startedAttemptQueryKey('test-1')), undefined);
});

/** The cost this prevents: a paper built and shipped per student at the bell that the screen already holds. */
test('a start says whether the paper is already held', async (t) => {
  const asked: (boolean | undefined)[] = [];
  const api = {
    me: {
      startAttempt: async (_testId: string, input: { holdsPaper?: boolean }) => {
        asked.push(input.holdsPaper);
        return { id: 'attempt-1', testId: 'test-1', languages: [], paper: null };
      },
      attemptPaper: () => new Promise(() => undefined),
    },
  } as unknown as AppApiClient;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  t.after(() => client.clear());
  const mount = () =>
    renderHook(() => useStartedSitting(api, 'test-1', { tab: 'tab-1' }), {
      wrapper: ({ children }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    });

  const first = mount();
  await act(nextTick);
  first.unmount();
  await nextTick();
  assert.deepEqual(asked, [false], 'nothing held, so the start carries the paper');

  client.setQueryData(testPaperQueryKey('test-1', []), { questions: [] });
  const second = mount();
  t.after(second.unmount);
  await act(nextTick);
  assert.deepEqual(asked, [false, true], 'held, so the start carries none');
});

/** The failure this prevents: a start that lands after its screen went, reused on re-entry with a stale clock. */
test('a start still in the air when its screen goes is not kept for the next entry', async (t) => {
  let land: (attempt: unknown) => void = () => {};
  const api = {
    me: {
      startAttempt: () => new Promise((resolve) => (land = resolve)),
    },
  } as unknown as AppApiClient;
  const { client, unmount } = mountedStart(api, t);
  await act(nextTick);

  unmount();
  land({ id: 'attempt-1', paper: null });
  await nextTick();
  await nextTick();
  assert.equal(client.getQueryData(startedAttemptQueryKey('test-1')), undefined);
});
