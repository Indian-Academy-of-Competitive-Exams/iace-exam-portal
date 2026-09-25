import test from 'node:test';
import assert from 'node:assert/strict';
import { act, renderHook } from '@testing-library/react';
import { ANSWER_STATE, AppException, ErrorCodes, type ExamClock } from '@iace/contracts';
import { useAttemptState } from '../src/exam/use-attempt-state';
import type { AppApiClient, KeyValueStorage } from '../src';
import { fakeStorage } from './support/fake-storage';

const QUEUE_KEY = 'test.queued.attempt-1';

const depsFor = (api: AppApiClient, storage: KeyValueStorage = fakeStorage()) => ({
  api,
  tab: 'tab-1',
  answerQueue: { storage, keyPrefix: 'test.queued' },
});

// The hook seeds from this on mount; every double needs it, since it is not what is under test.
const attemptStateStub = async () => ({ answers: {}, sections: {}, revision: 0 });

function apiThatFails(calls: unknown[]): AppApiClient {
  return {
    me: {
      attemptState: attemptStateStub,
      saveAttemptState: async (_id: string, body: unknown) => {
        calls.push(body);
        throw new Error('offline');
      },
    },
  } as unknown as AppApiClient;
}

test('a flush that succeeds clears pending and advances the revision', async (t) => {
  const sent: Array<{ revision: number; answers: unknown[]; tab?: string }> = [];
  const api = {
    me: {
      attemptState: attemptStateStub,
      saveAttemptState: async (
        _id: string,
        body: { revision: number; answers: unknown[]; tab?: string },
      ) => {
        sent.push(body);
        return { revision: body.revision };
      },
    },
  } as unknown as AppApiClient;

  const deps = depsFor(api);
  const { result, unmount } = renderHook(() => useAttemptState('attempt-1', deps));
  t.after(unmount);

  act(() => result.current.answer('q1', { selectedOptionId: 'opt-1' }));
  await act(async () => void (await result.current.flush()));

  assert.equal(sent.length, 1);
  assert.equal(sent[0]?.tab, 'tab-1', 'every save names the tab answering');
  assert.equal(sent[0]?.revision, 1, 'the first batch goes up under revision 1');
  assert.equal(result.current.hasUnsaved, false, 'a saved sitting says nothing is outstanding');

  await act(async () => void (await result.current.flush()));
  assert.equal(sent.length, 1, 'an empty flush sends nothing');
});

/** The failure this prevents: an admin grants ten minutes and the running screen never hears of it. */
test('takes the deadline a save answers with, so an extension needs no reload', async (t) => {
  const EXTENDED = '2099-01-01T10:10:00.000Z';
  const api = {
    me: {
      attemptState: attemptStateStub,
      saveAttemptState: async (_id: string, body: { revision: number }) => ({
        revision: body.revision,
        endsAt: EXTENDED,
        serverNow: '2099-01-01T10:00:00.000Z',
      }),
    },
  } as unknown as AppApiClient;

  const deps = depsFor(api);
  const { result, unmount } = renderHook(() => useAttemptState('attempt-1', deps));
  t.after(unmount);

  const before: ExamClock | null = result.current.clock;
  assert.equal(before, null, 'the paper is the only clock until a save answers');

  act(() => result.current.answer('q1', { selectedOptionId: 'opt-1' }));
  await act(async () => void (await result.current.flush()));

  assert.equal(result.current.clock?.endsAt, EXTENDED);
});

test('a failed flush requeues its changes and reports unsaved work', async (t) => {
  const calls: unknown[] = [];
  const deps = depsFor(apiThatFails(calls));
  const { result, unmount } = renderHook(() => useAttemptState('attempt-1', deps));
  t.after(unmount);

  act(() => result.current.answer('q1', { selectedOptionId: 'opt-1' }));
  await act(async () => void (await result.current.flush()));

  assert.equal(calls.length, 1, 'the first flush was attempted');
  assert.equal(result.current.hasUnsaved, true, 'a failed save is visible to the student');

  await act(async () => void (await result.current.flush()));
  assert.equal(calls.length, 2, 'the requeued change is sent again rather than dropped');
  assert.equal(result.current.takenOver, false, 'an ordinary failure is not a takeover');
});

/** The failure this prevents: submit's await resolving as a no-op while the last batch still flies. */
test('a flush during an in-flight save waits its turn and then delivers what arrived meanwhile', async (t) => {
  const sent: Array<{ revision: number; answers: Array<{ questionId: string }> }> = [];
  let release = () => {};
  const api = {
    me: {
      attemptState: attemptStateStub,
      saveAttemptState: async (_id: string, body: { revision: number }) => {
        sent.push(body as (typeof sent)[number]);
        if (sent.length === 1) await new Promise<void>((resolve) => (release = resolve));
        return { revision: body.revision };
      },
    },
  } as unknown as AppApiClient;

  const deps = depsFor(api);
  const { result, unmount } = renderHook(() => useAttemptState('attempt-1', deps));
  t.after(unmount);

  act(() => result.current.answer('q1', { selectedOptionId: 'opt-1' }));
  act(() => void result.current.flush());

  act(() => result.current.answer('q2', { selectedOptionId: 'opt-2' }));
  let second: Promise<boolean> = Promise.resolve(false);
  act(() => void (second = result.current.flush()));
  assert.equal(sent.length, 1, 'the second flush waits instead of resolving as a no-op');

  let delivered = false;
  await act(async () => {
    release();
    delivered = await second;
  });

  assert.equal(sent.length, 2, 'what arrived during the flight went up right after it');
  assert.equal(sent[1]?.answers[0]?.questionId, 'q2');
  assert.equal(delivered, true, 'submit can now trust the await to mean everything is saved');
});

test('a newer edit made during a failed flush is not overwritten by the requeue', async (t) => {
  const calls: Array<{ answers: Array<{ questionId: string; selectedOptionId: string | null }> }> =
    [];
  let release = () => {};
  const api = {
    me: {
      attemptState: attemptStateStub,
      saveAttemptState: async (_id: string, body: never) => {
        calls.push(body);
        await new Promise<void>((resolve) => (release = resolve));
        throw new Error('offline');
      },
    },
  } as unknown as AppApiClient;

  const deps = depsFor(api);
  const { result, unmount } = renderHook(() => useAttemptState('attempt-1', deps));
  t.after(unmount);

  act(() => result.current.answer('q1', { selectedOptionId: 'opt-1' }));
  let flying: Promise<boolean> = Promise.resolve(false);
  act(() => void (flying = result.current.flush()));

  act(() => result.current.answer('q1', { selectedOptionId: 'opt-2' }));
  await act(async () => {
    release();
    await flying;
  });

  // Not awaited: the second save blocks on its own release; we only need the retry's body.
  act(() => void result.current.flush());
  const resent = calls[1]?.answers.find((row) => row.questionId === 'q1');
  assert.equal(resent?.selectedOptionId, 'opt-2', 'the newer edit survived the requeue');
});

test('answers a save could not deliver are drawn again and re-sent after a remount', async (t) => {
  const storage = fakeStorage();
  const offlineDeps = depsFor(apiThatFails([]), storage);
  const offline = renderHook(() => useAttemptState('attempt-1', offlineDeps));
  act(() => offline.result.current.answer('q1', { selectedOptionId: 'opt-1' }));
  await act(async () => void (await offline.result.current.flush()));
  offline.unmount();

  const sent: Array<{ answers: Array<{ questionId: string; selectedOptionId: string | null }> }> =
    [];
  const api = {
    me: {
      attemptState: attemptStateStub,
      saveAttemptState: async (_id: string, body: { revision: number } & (typeof sent)[number]) => {
        sent.push(body);
        return { revision: body.revision };
      },
    },
  } as unknown as AppApiClient;
  const deps = depsFor(api, storage);
  const { result, unmount } = renderHook(() => useAttemptState('attempt-1', deps));
  t.after(unmount);

  assert.equal(result.current.answers.q1?.selectedOptionId, 'opt-1', 'on screen before any save');
  await act(async () => void (await result.current.flush()));
  const resent = sent[0]?.answers.find((row) => row.questionId === 'q1');
  assert.equal(resent?.selectedOptionId, 'opt-1', 'and sent again');
  assert.equal(storage.getItem(QUEUE_KEY), null, 'a delivered queue is not kept');
});

test('banking the open question keeps an answer redrawn from the queue', async (t) => {
  const storage = fakeStorage();
  storage.setItem(
    QUEUE_KEY,
    JSON.stringify([
      {
        questionId: 'q1',
        state: ANSWER_STATE.ANSWERED,
        selectedOptionId: 'opt-1',
        typedAnswer: null,
        timeSpentSec: 5,
        firstActionAt: '2026-09-17T04:00:00.000Z',
      },
    ]),
  );
  const sent: Array<{ answers: Array<{ questionId: string; selectedOptionId: string | null }> }> =
    [];
  const api = {
    me: {
      // Offline: the server's copy never lands, so the queue is all the screen has.
      attemptState: () => new Promise(() => {}),
      saveAttemptState: async (_id: string, body: { revision: number } & (typeof sent)[number]) => {
        sent.push(body);
        return { revision: body.revision };
      },
    },
  } as unknown as AppApiClient;
  const deps = depsFor(api, storage);
  const { result, unmount } = renderHook(() => useAttemptState('attempt-1', deps));
  t.after(unmount);

  act(() => result.current.open('q1'));
  act(() => result.current.bankOpen());
  await act(async () => void (await result.current.flush()));

  assert.equal(result.current.answers.q1?.selectedOptionId, 'opt-1', 'still on screen');
  const banked = sent[0]?.answers.find((row) => row.questionId === 'q1');
  assert.equal(banked?.selectedOptionId, 'opt-1', 'and still what is sent');
});

test('a save refused as taken over stops saving and says so', async (t) => {
  const calls: unknown[] = [];
  const api = {
    me: {
      attemptState: attemptStateStub,
      saveAttemptState: async (_id: string, body: unknown) => {
        calls.push(body);
        throw new AppException(ErrorCodes.SITTING_TAKEN_OVER);
      },
    },
  } as unknown as AppApiClient;
  const deps = depsFor(api);
  const { result, unmount } = renderHook(() => useAttemptState('attempt-1', deps));
  t.after(unmount);

  act(() => result.current.answer('q1', { selectedOptionId: 'opt-1' }));
  await act(async () => void (await result.current.flush()));
  assert.equal(result.current.takenOver, true);

  act(() => result.current.answer('q2', { selectedOptionId: 'opt-2' }));
  await act(async () => void (await result.current.flush()));
  assert.equal(calls.length, 1, 'a tab that lost the sitting does not fight for it');
});

test('standing down stops saving and says so, the same as a refused save', async (t) => {
  const calls: unknown[] = [];
  const api = {
    me: {
      attemptState: attemptStateStub,
      saveAttemptState: async (_id: string, body: unknown) => {
        calls.push(body);
        return { revision: 1 };
      },
    },
  } as unknown as AppApiClient;
  const deps = depsFor(api);
  const { result, unmount } = renderHook(() => useAttemptState('attempt-1', deps));
  t.after(unmount);

  act(() => result.current.standDown());
  assert.equal(result.current.takenOver, true);

  act(() => result.current.answer('q1', { selectedOptionId: 'opt-1' }));
  await act(async () => void (await result.current.flush()));
  assert.equal(calls.length, 0, 'a stood-down tab sends nothing more');
});
