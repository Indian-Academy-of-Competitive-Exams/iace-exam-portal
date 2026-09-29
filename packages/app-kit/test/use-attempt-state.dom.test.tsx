import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { act, renderHook } from '@testing-library/react';
import { ANSWER_STATE, AppException, ErrorCodes, type ExamClock } from '@iace/contracts';
import { useAttemptState } from '../src/exam/use-attempt-state';
import { AUTOSAVE_AT_COUNT, FINISH_WAIT_MS, SAVE_TIMEOUT_MS } from '../src/autosave-policy';
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

type SentAnswers = { answers: Array<{ questionId: string; selectedOptionId: string | null }> };

function apiThatSaves(sent: SentAnswers[]): AppApiClient {
  return {
    me: {
      attemptState: attemptStateStub,
      saveAttemptState: async (_id: string, body: { revision: number } & SentAnswers) => {
        sent.push(body);
        return { revision: body.revision, applied: true };
      },
    },
  } as unknown as AppApiClient;
}

/** The failure this prevents: a full bubble or Mark & Next banking the visit from the copy before the tap. */
test('an answer and a move in one tap keep the answer, on screen and in the next save', async (t) => {
  const sent: SentAnswers[] = [];
  const { result, unmount } = renderHook(() =>
    useAttemptState('attempt-1', depsFor(apiThatSaves(sent))),
  );
  t.after(unmount);
  await act(async () => void (await Promise.resolve()));

  act(() => result.current.open('q1'));
  act(() => {
    result.current.answer('q1', { selectedOptionId: 'opt-1' });
    result.current.open('q2');
  });
  assert.equal(result.current.answers.q1?.selectedOptionId, 'opt-1', 'still on screen');

  act(() => result.current.open('q1'));
  act(() => result.current.open('q2'));
  await act(async () => void (await result.current.flush()));
  const saved = sent.at(-1)?.answers.find((row) => row.questionId === 'q1');
  assert.equal(saved?.selectedOptionId, 'opt-1', 'leaving it again does not save a blank over it');
});

/** The failure this prevents: the ack for the old copy taking the newer one out of the queue with it. */
test('an answer changed while its save is in the air goes up in the next save', async (t) => {
  const sent: SentAnswers[] = [];
  let release = () => {};
  const api = {
    me: {
      attemptState: attemptStateStub,
      saveAttemptState: async (_id: string, body: { revision: number } & SentAnswers) => {
        sent.push(body);
        if (sent.length === 1) await new Promise<void>((resolve) => (release = resolve));
        return { revision: body.revision, applied: true };
      },
    },
  } as unknown as AppApiClient;
  const { result, unmount } = renderHook(() => useAttemptState('attempt-1', depsFor(api)));
  t.after(unmount);

  act(() => result.current.answer('q1', { selectedOptionId: 'opt-1' }));
  let flying: Promise<boolean> = Promise.resolve(false);
  act(() => void (flying = result.current.flush()));
  act(() => result.current.answer('q1', { selectedOptionId: 'opt-2' }));
  await act(async () => {
    release();
    await flying;
  });

  assert.equal(result.current.hasUnsent(), true, 'the ack for opt-1 does not settle opt-2');
  await act(async () => void (await result.current.flush()));
  const resent = sent[1]?.answers.find((row) => row.questionId === 'q1');
  assert.equal(resent?.selectedOptionId, 'opt-2');
});

test('a failed save loses nothing, and the next save carries all of it', async (t) => {
  const bodies: SentAnswers[] = [];
  let online = false;
  const api = {
    me: {
      attemptState: attemptStateStub,
      saveAttemptState: async (_id: string, body: { revision: number } & SentAnswers) => {
        bodies.push(body);
        if (!online) throw new Error('offline');
        return { revision: body.revision, applied: true };
      },
    },
  } as unknown as AppApiClient;
  const { result, unmount } = renderHook(() => useAttemptState('attempt-1', depsFor(api)));
  t.after(unmount);

  act(() => result.current.answer('q1', { selectedOptionId: 'opt-1' }));
  act(() => result.current.answer('q2', { selectedOptionId: 'opt-2' }));
  await act(async () => void (await result.current.flush()));
  assert.equal(result.current.answers.q2?.selectedOptionId, 'opt-2', 'still on screen');

  online = true;
  assert.equal(await act(() => result.current.flush()), true);
  const retried = Object.fromEntries(
    (bodies[1]?.answers ?? []).map((row) => [row.questionId, row.selectedOptionId]),
  );
  assert.deepEqual(retried, { q1: 'opt-1', q2: 'opt-2' });
  assert.equal(result.current.hasUnsent(), false);
});

/** The failure this prevents: the tab reloading with a save in the air and a newer answer behind it. */
test('a reload draws and sends the newest unsent copy of every answer', async (t) => {
  const storage = fakeStorage();
  const hung = {
    me: { attemptState: attemptStateStub, saveAttemptState: () => new Promise(() => undefined) },
  } as unknown as AppApiClient;
  const before = renderHook(() => useAttemptState('attempt-1', depsFor(hung, storage)));
  act(() => before.result.current.answer('q1', { selectedOptionId: 'opt-1' }));
  act(() => void before.result.current.flush());
  act(() => before.result.current.answer('q1', { selectedOptionId: 'opt-2' }));
  act(() => before.result.current.answer('q2', { selectedOptionId: 'opt-3' }));
  before.unmount();

  const sent: SentAnswers[] = [];
  const { result, unmount } = renderHook(() =>
    useAttemptState('attempt-1', depsFor(apiThatSaves(sent), storage)),
  );
  t.after(unmount);

  assert.equal(result.current.answers.q1?.selectedOptionId, 'opt-2');
  assert.equal(result.current.answers.q2?.selectedOptionId, 'opt-3');
  await act(async () => void (await result.current.flush()));
  const resent = Object.fromEntries(
    (sent[0]?.answers ?? []).map((row) => [row.questionId, row.selectedOptionId]),
  );
  assert.deepEqual(resent, { q1: 'opt-2', q2: 'opt-3' });
});

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

/** The failure this prevents: Continue here replaying this tab's old answer over the one the other device gave. */
test('a tab that lost the sitting drops what it never delivered, and says how much', async (t) => {
  const storage = fakeStorage();
  const refused = {
    me: {
      attemptState: attemptStateStub,
      saveAttemptState: async () => {
        throw new AppException(ErrorCodes.SITTING_TAKEN_OVER);
      },
    },
  } as unknown as AppApiClient;
  const before = renderHook(() => useAttemptState('attempt-1', depsFor(refused, storage)));
  await act(async () => void (await Promise.resolve()));
  act(() => before.result.current.answer('q1', { selectedOptionId: 'mine' }));
  await act(async () => void (await before.result.current.flush()));
  act(() => before.result.current.answer('q2', { selectedOptionId: 'after' }));
  const dropped = before.result.current.droppedUnsaved;
  before.unmount();

  const sent: SentAnswers[] = [];
  const theirs = {
    me: {
      attemptState: async () => ({
        answers: { q1: { state: ANSWER_STATE.ANSWERED, selectedOptionId: 'theirs' } },
        sections: {},
        revision: 5,
      }),
      saveAttemptState: async (_id: string, body: { revision: number } & SentAnswers) => {
        sent.push(body);
        return { revision: body.revision, applied: true };
      },
    },
  } as unknown as AppApiClient;
  const { result, unmount } = renderHook(() =>
    useAttemptState('attempt-1', depsFor(theirs, storage)),
  );
  t.after(unmount);
  await act(async () => void (await Promise.resolve()));
  await act(async () => void (await result.current.flush()));

  assert.equal(dropped, 1, 'the takeover screen can say how many');
  assert.equal(result.current.answers.q1?.selectedOptionId, 'theirs');
  assert.equal(result.current.answers.q2, undefined, 'nor is anything done here after it lost');
  assert.equal(sent.length, 0, "nothing of this tab's is sent over it");
});

/** The failure this prevents: plain moves between questions reported as answers that will not be kept. */
test('the takeover count is the answers given here, not the questions only passed through', async (t) => {
  const refused = {
    me: {
      attemptState: attemptStateStub,
      saveAttemptState: async () => {
        throw new AppException(ErrorCodes.SITTING_TAKEN_OVER);
      },
    },
  } as unknown as AppApiClient;
  const { result, unmount } = renderHook(() => useAttemptState('attempt-1', depsFor(refused)));
  t.after(unmount);
  await act(async () => void (await Promise.resolve()));

  act(() => {
    for (const questionId of ['q1', 'q2', 'q3', 'q4', 'q5', 'q6']) result.current.open(questionId);
  });
  act(() => result.current.answer('q6', { selectedOptionId: 'opt-6' }));
  await act(async () => void (await result.current.flush()));

  assert.equal(result.current.droppedUnsaved, 1);
});

/** The failure this prevents: opening a second test on the phone wiping the answers queued in the first on a laptop. */
test('a tab set aside for another test keeps what it never saved, and sends it when continued', async (t) => {
  const storage = fakeStorage();
  const setAside = {
    me: {
      attemptState: attemptStateStub,
      saveAttemptState: async () => {
        throw new AppException(ErrorCodes.SITTING_SET_ASIDE);
      },
    },
  } as unknown as AppApiClient;
  const before = renderHook(() => useAttemptState('attempt-1', depsFor(setAside, storage)));
  await act(async () => void (await Promise.resolve()));
  act(() => before.result.current.answer('q1', { selectedOptionId: 'mine' }));
  await act(async () => void (await before.result.current.flush()));
  const stood = { ...before.result.current };
  before.unmount();

  const sent: SentAnswers[] = [];
  const { result, unmount } = renderHook(() =>
    useAttemptState('attempt-1', depsFor(apiThatSaves(sent), storage)),
  );
  t.after(unmount);
  await act(async () => void (await Promise.resolve()));
  await act(async () => void (await result.current.flush()));

  assert.equal(stood.takenOver, true, 'it stopped saving');
  assert.equal(stood.setAside, true, 'and says why');
  assert.equal(stood.droppedUnsaved, 0);
  assert.equal(sent[0]?.answers.find((row) => row.questionId === 'q1')?.selectedOptionId, 'mine');
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

/** Lets a mocked timer's callback, and the promise chain it starts, run to the end. */
async function settle() {
  for (let turn = 0; turn < 10; turn += 1) await Promise.resolve();
}

/** The failure this prevents: a save that never answers holding every later save, and the submit, behind it. */
test('a save the server never answers is given up, and its answers wait for the next', async (t) => {
  mock.timers.enable({ apis: ['setTimeout'] });
  const api = {
    me: {
      attemptState: attemptStateStub,
      saveAttemptState: (_id: string, _body: unknown, extra: { signal?: AbortSignal } = {}) =>
        new Promise((_resolve, reject) => {
          extra.signal?.addEventListener('abort', () =>
            reject(new AppException(ErrorCodes.INTERNAL, 'gone', { httpStatus: 0 })),
          );
        }),
    },
  } as unknown as AppApiClient;
  const { result, unmount } = renderHook(() => useAttemptState('attempt-1', depsFor(api)));
  t.after(() => {
    unmount();
    mock.timers.reset();
  });

  act(() => result.current.answer('q1', { selectedOptionId: 'opt-1' }));
  let delivered: boolean | 'waiting' = 'waiting';
  act(() => void result.current.flush().then((landed) => (delivered = landed)));
  await act(async () => {
    mock.timers.tick(SAVE_TIMEOUT_MS);
    await settle();
  });

  assert.equal(delivered, false, 'given up, as a failed save');
  assert.equal(result.current.hasUnsaved, true, 'and said so');
  assert.equal(result.current.hasUnsent(), true, 'its answers kept for the next save');
});

/** The failure this prevents: the deadline's submit waiting forever on a save that hung. */
test("the paper goes in with a hung save's answers once it has waited long enough", async (t) => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const api = {
    me: {
      attemptState: attemptStateStub,
      saveAttemptState: () => new Promise(() => undefined),
    },
  } as unknown as AppApiClient;
  const { result, unmount } = renderHook(() => useAttemptState('attempt-1', depsFor(api)));
  t.after(() => {
    unmount();
    mock.timers.reset();
  });

  act(() => result.current.answer('q1', { selectedOptionId: 'opt-1' }));
  act(() => void result.current.flush());
  act(() => result.current.answer('q2', { selectedOptionId: 'opt-2' }));
  let carried: string[] | null = null;
  act(
    () =>
      void result.current.finish(async (batch) => {
        carried = (batch?.answers ?? []).map((change) => change.questionId);
      }),
  );
  await act(async () => {
    mock.timers.tick(FINISH_WAIT_MS);
    await settle();
  });

  assert.deepEqual(carried, ['q1', 'q2']);
});

/** The failure this prevents: the old screen's late ack deleting what the remounted one has queued since. */
test('a save that lands after its screen unmounted leaves the stored queue alone', async () => {
  const storage = fakeStorage();
  let land = () => {};
  const slow = {
    me: {
      attemptState: attemptStateStub,
      saveAttemptState: async (_id: string, body: { revision: number }) => {
        await new Promise<void>((resolve) => (land = resolve));
        return { revision: body.revision, applied: true };
      },
    },
  } as unknown as AppApiClient;
  const before = renderHook(() => useAttemptState('attempt-1', depsFor(slow, storage)));
  act(() => before.result.current.answer('q1', { selectedOptionId: 'opt-1' }));
  let flying: Promise<boolean> = Promise.resolve(true);
  act(() => void (flying = before.result.current.flush()));
  before.unmount();

  const after = renderHook(() => useAttemptState('attempt-1', depsFor(slow, storage)));
  act(() => after.result.current.answer('q2', { selectedOptionId: 'opt-2' }));
  await act(async () => {
    land();
    await flying;
  });
  const kept = storage.getItem(QUEUE_KEY);
  after.unmount();

  assert.ok(kept?.includes('q2'), `the queue still holds q2: ${kept}`);
});

/** The failure this prevents: a full queue and a dead network turning every tap into another failed save. */
test('while saves fail, a full queue waits for the timer instead of saving on every tap', async (t) => {
  const calls: unknown[] = [];
  const deps = depsFor(apiThatFails(calls));
  const { result, unmount } = renderHook(() => useAttemptState('attempt-1', deps));
  t.after(unmount);

  act(() => {
    for (let n = 1; n <= AUTOSAVE_AT_COUNT; n += 1) {
      result.current.answer(`q${n}`, { selectedOptionId: 'opt' });
    }
  });
  await act(settle);
  assert.equal(calls.length, 1, 'the full queue went up once');

  act(() => result.current.answer('q-late-1', { selectedOptionId: 'opt' }));
  act(() => result.current.answer('q-late-2', { selectedOptionId: 'opt' }));
  await act(settle);
  assert.equal(calls.length, 1, 'no save per tap while the last one failed');

  await act(async () => void (await result.current.flush()));
  assert.equal(calls.length, 2, "the timer's save still goes");
});
