import test from 'node:test';
import assert from 'node:assert/strict';
import { act, renderHook } from '@testing-library/react';
import { useAttemptState } from '../src/exam/use-attempt-state';
import type { AppApiClient } from '../src';

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

test('a flush that succeeds clears pending and advances the revision', async () => {
  const sent: Array<{ revision: number; answers: unknown[] }> = [];
  const api = {
    me: {
      attemptState: attemptStateStub,
      saveAttemptState: async (_id: string, body: { revision: number; answers: unknown[] }) => {
        sent.push(body);
        return { revision: body.revision };
      },
    },
  } as unknown as AppApiClient;

  const { result, unmount } = renderHook(() => useAttemptState('attempt-1', api));

  act(() => result.current.answer('q1', { selectedOptionId: 'opt-1' }));
  await act(async () => void (await result.current.flush()));

  assert.equal(sent.length, 1);
  assert.equal(sent[0]?.revision, 1, 'the first batch goes up under revision 1');
  assert.equal(result.current.hasUnsaved, false, 'a saved sitting says nothing is outstanding');

  await act(async () => void (await result.current.flush()));
  assert.equal(sent.length, 1, 'an empty flush sends nothing');
  unmount();
});

test('a failed flush requeues its changes and reports unsaved work', async () => {
  const calls: unknown[] = [];
  const { result, unmount } = renderHook(() => useAttemptState('attempt-1', apiThatFails(calls)));

  act(() => result.current.answer('q1', { selectedOptionId: 'opt-1' }));
  await act(async () => void (await result.current.flush()));

  assert.equal(calls.length, 1, 'the first flush was attempted');
  assert.equal(result.current.hasUnsaved, true, 'a failed save is visible to the student');

  await act(async () => void (await result.current.flush()));
  assert.equal(calls.length, 2, 'the requeued change is sent again rather than dropped');
  unmount();
});

test('a newer edit made during a failed flush is not overwritten by the requeue', async () => {
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

  const { result, unmount } = renderHook(() => useAttemptState('attempt-1', api));

  act(() => result.current.answer('q1', { selectedOptionId: 'opt-1' }));
  let flying: Promise<void> = Promise.resolve();
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
  unmount();
});
