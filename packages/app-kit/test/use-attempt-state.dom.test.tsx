import test, { mock } from 'node:test';
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

/** The failure this prevents: one failed read at load leaving a reloaded paper blank for the whole sitting. */
test('a seed that failed is asked again until the held answers land', async (t) => {
  mock.timers.enable({ apis: ['setTimeout'] });
  let asked = 0;
  const api = {
    me: {
      attemptState: async () => {
        asked += 1;
        if (asked === 1) throw new AppException(ErrorCodes.INTERNAL, 'down', { httpStatus: 503 });
        return {
          answers: { q1: { state: ANSWER_STATE.ANSWERED, selectedOptionId: 'opt-1' } },
          sections: {},
          revision: 4,
        };
      },
      saveAttemptState: async () => ({ revision: 0 }),
    },
  } as unknown as AppApiClient;
  const deps = depsFor(api);
  const { result, unmount } = renderHook(() => useAttemptState('attempt-1', deps));
  t.after(() => {
    unmount();
    mock.timers.reset();
  });

  await act(async () => void (await Promise.resolve()));
  assert.equal(result.current.sectionsSeeded, false, 'not seeded yet');

  await act(async () => {
    mock.timers.tick(31_000);
    await Promise.resolve();
  });
  assert.equal(asked, 2);
  assert.equal(result.current.answers.q1?.selectedOptionId, 'opt-1', 'the held answer is drawn');
  assert.equal(result.current.sectionsSeeded, true);
});

test('a seed the server refused is not asked again', async (t) => {
  mock.timers.enable({ apis: ['setTimeout'] });
  let asked = 0;
  const api = {
    me: {
      attemptState: async () => {
        asked += 1;
        throw new AppException(ErrorCodes.NOT_FOUND);
      },
      saveAttemptState: async () => ({ revision: 0 }),
    },
  } as unknown as AppApiClient;
  const deps = depsFor(api);
  const { unmount } = renderHook(() => useAttemptState('attempt-1', deps));
  t.after(() => {
    unmount();
    mock.timers.reset();
  });

  await act(async () => {
    await Promise.resolve();
    mock.timers.tick(61_000);
    await Promise.resolve();
  });
  assert.equal(asked, 1);
});

/** The failure this prevents: a full store killing autosave for the rest of the sitting. */
test('a store that refuses to write never stops the answers being saved', async (t) => {
  const sent: unknown[] = [];
  const api = {
    me: {
      attemptState: attemptStateStub,
      saveAttemptState: async (_id: string, body: { revision: number }) => {
        sent.push(body);
        return { revision: body.revision };
      },
    },
  } as unknown as AppApiClient;
  const full: KeyValueStorage = {
    getItem: () => null,
    setItem: () => {
      throw new Error('QuotaExceededError');
    },
    removeItem: () => {
      throw new Error('QuotaExceededError');
    },
  };
  const deps = depsFor(api, full);
  const { result, unmount } = renderHook(() => useAttemptState('attempt-1', deps));
  t.after(unmount);

  act(() => result.current.answer('q1', { selectedOptionId: 'opt-1' }));
  assert.equal(await act(() => result.current.flush()), true, 'the first save lands');

  act(() => result.current.answer('q2', { selectedOptionId: 'opt-2' }));
  assert.equal(await act(() => result.current.flush()), true, 'and so does the next one');
  assert.equal(sent.length, 2);
});

/** The failure this prevents: a save hangs, the student moves on, the tab reloads — and the batch in the air is gone. */
test('keeps the batch in the air on the device until the server answers it', async (t) => {
  const storage = fakeStorage();
  const api = {
    me: {
      attemptState: attemptStateStub,
      saveAttemptState: () => new Promise(() => undefined),
    },
  } as unknown as AppApiClient;
  const { result, unmount } = renderHook(() => useAttemptState('attempt-1', depsFor(api, storage)));
  t.after(unmount);

  act(() => result.current.answer('q1', { selectedOptionId: 'opt-1' }));
  act(() => void result.current.flush());
  act(() => result.current.answer('q2', { selectedOptionId: 'opt-2' }));

  const kept = JSON.parse(storage.getItem(QUEUE_KEY) ?? '[]') as { questionId: string }[];
  assert.deepEqual(
    kept.map((change) => change.questionId).sort((a, b) => a.localeCompare(b)),
    ['q1', 'q2'],
  );
});

/** Unseeded, a bare visit says "no answer", and a later save would clear the one the server holds. */
test('banks no bare visit before the server has said what is already answered', async (t) => {
  const sent: unknown[] = [];
  const api = {
    me: {
      attemptState: () => new Promise(() => undefined),
      saveAttemptState: async (_id: string, body: { revision: number }) => {
        sent.push(body);
        return { revision: body.revision };
      },
    },
  } as unknown as AppApiClient;
  const { result, unmount } = renderHook(() => useAttemptState('attempt-1', depsFor(api)));
  t.after(unmount);

  act(() => result.current.open('q1'));
  act(() => result.current.open('q2'));
  await act(async () => void (await result.current.flush()));

  assert.equal(sent.length, 0, 'nothing was answered here, so nothing is sent');
});

/** The failure this prevents: the tab closes with answers unsent, and sessionStorage goes with it. */
test('sends everything unsent on the way out, on a request that outlives the page', async (t) => {
  const storage = fakeStorage();
  const sent: { answers: { questionId: string }[]; keepalive?: boolean }[] = [];
  const api = {
    me: {
      attemptState: attemptStateStub,
      saveAttemptState: (
        _id: string,
        body: { answers: { questionId: string }[] },
        extra: { keepalive?: boolean } = {},
      ) => {
        sent.push({ answers: body.answers, keepalive: extra.keepalive });
        // The first save hangs, so q1 is still in the air when the page goes.
        return sent.length === 1 ? new Promise(() => undefined) : Promise.resolve({ revision: 9 });
      },
    },
  } as unknown as AppApiClient;
  const { result, unmount } = renderHook(() => useAttemptState('attempt-1', depsFor(api, storage)));
  t.after(unmount);

  assert.equal(result.current.hasUnsent(), false, 'nothing done, nothing to ask about');
  act(() => result.current.answer('q1', { selectedOptionId: 'opt-1' }));
  act(() => void result.current.flush());
  act(() => result.current.answer('q2', { selectedOptionId: 'opt-2' }));
  assert.equal(result.current.hasUnsent(), true);

  act(() => result.current.leave());

  const last = sent.at(-1);
  assert.equal(last?.keepalive, true);
  assert.deepEqual(
    last?.answers.map((change) => change.questionId).sort((a, b) => a.localeCompare(b)),
    ['q1', 'q2'],
  );
  assert.notEqual(storage.getItem(QUEUE_KEY), null, 'the local copy stays until a save lands');
});

test('a tab that was stood down sends nothing on the way out', async (t) => {
  const sent: unknown[] = [];
  const api = {
    me: {
      attemptState: attemptStateStub,
      saveAttemptState: async (_id: string, body: unknown) => {
        sent.push(body);
        return { revision: 1 };
      },
    },
  } as unknown as AppApiClient;
  const { result, unmount } = renderHook(() => useAttemptState('attempt-1', depsFor(api)));
  t.after(unmount);

  act(() => result.current.answer('q1', { selectedOptionId: 'opt-1' }));
  act(() => result.current.standDown());
  act(() => result.current.leave());

  assert.equal(sent.length, 0);
});

/** One request at the deadline, not a save and then a submit: the unsent batch rides the call that ends the sitting. */
test('hands the unsent batch to the call that ends the sitting, and saves nothing itself', async (t) => {
  const saves: unknown[] = [];
  const api = {
    me: {
      attemptState: attemptStateStub,
      saveAttemptState: async (_id: string, body: unknown) => {
        saves.push(body);
        return { revision: 1 };
      },
    },
  } as unknown as AppApiClient;
  const deps = depsFor(api);
  const { result, unmount } = renderHook(() => useAttemptState('attempt-1', deps));
  t.after(unmount);
  act(() => result.current.answer('q1', { selectedOptionId: 'opt-1' }));

  let carried: { revision: number; answers: { questionId: string }[] } | null = null;
  await act(async () => {
    await result.current.finish((batch) => {
      carried = batch;
      return Promise.resolve();
    });
  });

  assert.equal(saves.length, 0);
  assert.deepEqual(
    (carried as { answers: { questionId: string }[] } | null)?.answers.map((a) => a.questionId),
    ['q1'],
  );
  assert.equal(result.current.hasUnsent(), false);
});

/** The failure this prevents: a submit that failed losing the answers it carried, so the retry hands in less. */
test('puts the batch back when the ending call fails, so the retry carries it again', async (t) => {
  const deps = depsFor(apiThatFails([]));
  const { result, unmount } = renderHook(() => useAttemptState('attempt-1', deps));
  t.after(unmount);
  act(() => result.current.answer('q1', { selectedOptionId: 'opt-1' }));

  await act(async () => {
    await assert.rejects(result.current.finish(() => Promise.reject(new Error('offline'))));
  });
  assert.equal(result.current.hasUnsent(), true);

  const carried: string[] = [];
  await act(async () => {
    await result.current.finish((batch) => {
      carried.push(...(batch?.answers ?? []).map((a) => a.questionId));
      return Promise.resolve();
    });
  });
  assert.deepEqual(carried, ['q1']);
});

/** The failure this prevents: a save leaving beside the submit, landing after the claim, and its answers lost. */
test('sends no save while the paper is going in, nor after it went', async (t) => {
  const saves: unknown[] = [];
  const api = {
    me: {
      attemptState: attemptStateStub,
      saveAttemptState: async (_id: string, body: unknown) => {
        saves.push(body);
        return { revision: 1 };
      },
    },
  } as unknown as AppApiClient;
  const deps = depsFor(api);
  const { result, unmount } = renderHook(() => useAttemptState('attempt-1', deps));
  t.after(unmount);
  act(() => result.current.answer('q1', { selectedOptionId: 'opt-1' }));
  let land = () => {};
  const landed = new Promise<void>((resolve) => (land = resolve));

  let finishing: Promise<void> = Promise.resolve();
  act(() => void (finishing = result.current.finish(() => landed)));
  act(() => result.current.answer('q2', { selectedOptionId: 'opt-2' }));
  let flushing: Promise<boolean> = Promise.resolve(false);
  act(() => void (flushing = result.current.flush()));
  assert.equal(saves.length, 0, 'a flush during the submit waits behind it');

  await act(async () => {
    land();
    await finishing;
    await flushing;
  });
  assert.equal(saves.length, 0, 'once the paper is in, nothing more is saved');
});

/** The failure this prevents: the submit going out while a save it did not wait for is still in the air. */
test('goes in only once every save in the air has answered', async (t) => {
  let unresolved = 0;
  let releaseFirst = () => {};
  const api = {
    me: {
      attemptState: attemptStateStub,
      saveAttemptState: async (_id: string, body: { revision: number }) => {
        unresolved += 1;
        if (body.revision === 1) await new Promise<void>((resolve) => (releaseFirst = resolve));
        else await new Promise((resolve) => setTimeout(resolve, 5));
        unresolved -= 1;
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

  let inAirAtSubmit = -1;
  let finishing: Promise<void> = Promise.resolve();
  act(() => {
    void result.current.flush();
    finishing = result.current.finish(() => {
      inAirAtSubmit = unresolved;
      return Promise.resolve();
    });
  });
  await act(async () => {
    releaseFirst();
    await finishing;
  });

  assert.equal(inAirAtSubmit, 0);
});
