import test, { mock, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { act, renderHook } from '@testing-library/react';
import {
  focusManager,
  onlineManager,
  QueryClient,
  QueryClientProvider,
} from '@tanstack/react-query';
import {
  ANSWER_STATE,
  ATTEMPT_STATUS,
  AppException,
  ErrorCodes,
  NAVIGATION_POLICY,
  OMR_FILL,
  TIMER_TEMPLATE,
  type ExamPaper,
  type ExamQuestion,
  type SectionProgress,
} from '@iace/contracts';
import {
  PAPER_LOCK,
  TIMER_KIND,
  useExamView,
  type AppApiClient,
  type EndedSitting,
  type ExamEngineDeps,
  type FullscreenHandle,
} from '../src';
import {
  autosaveDelayMs,
  FINISH_WAIT_MS,
  SAVE_TIMEOUT_MS,
  SUBMIT_TIMEOUT_MS,
  submitRetryDelayMs,
} from '../src/autosave-policy';
import { fakeStorage } from './support/fake-storage';

const client = new QueryClient({
  defaultOptions: { queries: { gcTime: 0, retry: false }, mutations: { gcTime: 0 } },
});

const questionFor = (sectionId: string, order: number): ExamQuestion => ({
  questionId: `${sectionId}-q1`,
  order,
  baseConfigSectionId: sectionId,
  type: 'SINGLE_MCQ',
  marks: 1,
  negativeMarks: 0,
  content: {},
  options: [],
});

const paper = (): ExamPaper => ({
  attemptId: 'attempt-1',
  endsAt: '2026-09-01T07:00:00.000Z',
  serverNow: '2026-09-01T05:00:00.000Z',
  languages: ['EN'],
  languageMode: 'SINGLE',
  examTemplate: 'DEFAULT',
  testUi: 'CBT',
  timerTemplate: 'SECTIONAL_LOCKED',
  navigation: 'FREE',
  calculatorEnabled: false,
  sections: [
    { id: 'sec1', name: 'Section 1', order: 1, questionCount: 1, durationSec: 1800 },
    { id: 'sec2', name: 'Section 2', order: 2, questionCount: 1, durationSec: 1800 },
    { id: 'sec3', name: 'Section 3', order: 3, questionCount: 1, durationSec: 1800 },
  ],
  questions: [questionFor('sec1', 1), questionFor('sec2', 2), questionFor('sec3', 3)],
});

const focus: FullscreenHandle = {
  isFullscreen: false,
  isSupported: false,
  exits: 0,
  enter: async () => {},
  exit: async () => {},
};

function depsFor(api: AppApiClient): ExamEngineDeps {
  return {
    api,
    tab: 'tab-1',
    answerQueue: { storage: fakeStorage(), keyPrefix: 'test.queued' },
    focus,
    catalogQueryKey: ['catalog'],
  };
}

type SaveCall = { revision: number; sections?: Record<string, SectionProgress> };

function apiWith(
  sections: Record<string, SectionProgress>,
  onSave: (body: SaveCall) => void = () => {},
): AppApiClient {
  return {
    me: {
      attemptState: async () => ({ answers: {}, sections, revision: 0 }),
      saveAttemptState: async (_id: string, body: SaveCall) => {
        onSave(body);
        return {
          revision: body.revision,
          applied: true,
          endsAt: paper().endsAt,
          serverNow: paper().serverNow,
        };
      },
      submitAttempt: async () => {
        throw new Error('not used in this test');
      },
    },
  } as unknown as AppApiClient;
}

function mounted(
  api: AppApiClient,
  sitting: ExamPaper = paper(),
  onEnded: (ended: EndedSitting) => void = () => {},
  startedByThisCall = false,
) {
  const deps = depsFor(api);
  // Built once, the way a caller holds it: rebuilding the sitting per render would restart the paper's clock.
  const held = {
    paper: sitting,
    arrivedAt: Date.now(),
    startedByThisCall,
    title: null,
    watermark: '',
    onEnded,
  };
  return renderHook(() => useExamView(held, deps), {
    wrapper: ({ children }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
}

/** The failure this prevents: 7K candidates each asking for a state the start had just written empty. */
test('a sitting this screen started asks the server for no state at all', async (t) => {
  let asked = 0;
  const api = {
    me: {
      attemptState: async () => {
        asked += 1;
        return { answers: {}, sections: {}, revision: 0 };
      },
    },
  } as unknown as AppApiClient;

  const fresh = mounted(api, paper(), () => {}, true);
  t.after(fresh.unmount);
  await act(async () => {
    await Promise.resolve();
  });

  assert.equal(asked, 0);
  // Settled all the same, or a sectional paper would take no input while it waited on nothing.
  assert.deepEqual(fresh.result.current.reachable, ['sec1']);

  const reloaded = mounted(api);
  t.after(reloaded.unmount);
  await act(async () => {
    await Promise.resolve();
  });

  assert.equal(asked, 1);
});

/** The failure this prevents: a reloaded sitting mounting into section one though it closed long ago. */
test("a reload lands in the first section still open, not the paper's first", async (t) => {
  const api = apiWith({
    sec1: { remainingSec: 0, closed: true },
    sec2: { remainingSec: 0, closed: true },
    sec3: { remainingSec: 1200, closed: false, openedAt: '2026-09-01T04:50:00.000Z' },
  });
  const { result, unmount } = mounted(api);
  t.after(unmount);

  // The server's own section state has to arrive before the screen can trust it.
  await act(async () => {
    await Promise.resolve();
  });

  assert.deepEqual(result.current.reachable, ['sec3']);
  assert.equal(
    result.current.sectionId,
    'sec3',
    'the screen must not stay on the closed first section',
  );
});

/** The failure this prevents: section one's clock never being stamped, so a reload gives it back in full. */
test('a fresh sitting stamps its first section on the next save, not only on leaving it', async (t) => {
  mock.timers.enable({ apis: ['setTimeout'] });
  const sent: SaveCall[] = [];
  const api = apiWith({}, (body) => sent.push(body));
  const { result, unmount } = mounted(api);
  t.after(() => {
    unmount();
    mock.timers.reset();
  });

  await act(async () => {
    await Promise.resolve();
  });
  assert.equal(result.current.sectionId, 'sec1');

  // The periodic autosave is the only thing that ever carries a section to the server.
  await act(async () => {
    mock.timers.tick(31_000);
    await Promise.resolve();
    await Promise.resolve();
  });

  const stamped = sent.find((body) => body.sections?.sec1 !== undefined);
  assert.ok(
    stamped,
    'section one was carried in a save, not left to be stamped only when it is left',
  );
  assert.equal(stamped?.sections?.sec1?.closed, false);
});

/** The failure this prevents: the clock and a tap in the same instant handing the paper in twice. */
test('ending the paper twice before the next render submits it once', async (t) => {
  let submitted = 0;
  const api = {
    me: {
      attemptState: async () => ({ answers: {}, sections: {}, revision: 0 }),
      saveAttemptState: async () => ({ revision: 0 }),
      submitAttempt: async () => {
        submitted += 1;
        return { attemptId: 'attempt-1' };
      },
    },
  } as unknown as AppApiClient;
  const { result, unmount } = mounted(api, {
    ...paper(),
    timerTemplate: TIMER_TEMPLATE.COMPOSITE_FREE,
  });
  t.after(unmount);

  await act(async () => {
    result.current.timer.onExpire();
    result.current.submit.confirm();
    await Promise.resolve();
  });
  await act(async () => {
    await new Promise((settle) => setTimeout(settle, 0));
  });

  assert.equal(submitted, 1);
});

/** The failure this prevents: a section spent to 0 read as "no section clock", so it never closes on reload. */
test('the engine picks the one clock: the section while it has time allowed, else the paper', async (t) => {
  const timerOf = async (sitting: ExamPaper, sections: Record<string, SectionProgress> = {}) => {
    const { result, unmount } = mounted(apiWith(sections), sitting);
    t.after(unmount);
    await act(async () => {
      await Promise.resolve();
    });
    return result.current.timer;
  };
  const untimed = paper().sections.map((row) => ({ ...row, durationSec: null }));

  const composite = await timerOf({ ...paper(), timerTemplate: TIMER_TEMPLATE.COMPOSITE_FREE });
  assert.equal(composite.kind, TIMER_KIND.PAPER);
  assert.equal((await timerOf({ ...paper(), sections: untimed })).kind, TIMER_KIND.PAPER);

  const fresh = await timerOf(paper());
  assert.deepEqual(fresh.kind === TIMER_KIND.SECTION && [fresh.key, fresh.allowedSec], [
    'sec1',
    1800,
  ]);

  const spent = await timerOf(paper(), {
    sec1: { remainingSec: 0, closed: false, openedAt: '2026-09-01T04:00:00.000Z' },
  });
  assert.deepEqual(
    spent.kind === TIMER_KIND.SECTION && [spent.key, spent.allowedSec],
    ['sec1', 0],
    'a section with its time spent keeps its own clock, which expires on arrival',
  );
});

/** The failure this prevents: an acknowledged exit nagging on, or a second exit never asked about. */
test('leaving the paper nags until acknowledged, and again on the next exit', (t) => {
  const deps = depsFor(apiWith({}));
  const { result, rerender, unmount } = renderHook(
    ({ exits }) =>
      useExamView(
        {
          paper: paper(),
          arrivedAt: Date.now(),
          startedByThisCall: false,
          title: null,
          watermark: '',
          onEnded: () => {},
        },
        { ...deps, focus: { ...focus, isSupported: true, exits } },
      ),
    {
      initialProps: { exits: 0 },
      wrapper: ({ children }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    },
  );
  t.after(unmount);

  assert.equal(result.current.fullscreen.nagging, false);
  rerender({ exits: 1 });
  assert.equal(result.current.fullscreen.nagging, true);
  act(() => result.current.fullscreen.ignore());
  assert.equal(result.current.fullscreen.nagging, false);
  rerender({ exits: 2 });
  assert.equal(result.current.fullscreen.nagging, true);
});

/** The failure this prevents: the question a paper opens on staying "not visited", its seconds never banked. */
test('the question a screen lands on is open, so leaving it banks the visit', async (t) => {
  const landing: ExamPaper = {
    ...paper(),
    timerTemplate: TIMER_TEMPLATE.COMPOSITE_FREE,
    questions: [
      questionFor('sec1', 1),
      { ...questionFor('sec1', 2), questionId: 'sec1-q2' },
      questionFor('sec2', 3),
      questionFor('sec3', 4),
    ],
  };
  const { result, unmount } = mounted(apiWith({}), landing);
  t.after(unmount);
  await act(async () => {
    await Promise.resolve();
  });

  act(() => result.current.nextQuestion());
  assert.equal(result.current.answers['sec1-q1']?.state, ANSWER_STATE.NOT_ANSWERED, 'on load');

  act(() => result.current.openSection('sec2'));
  act(() => result.current.openSection('sec3'));
  assert.equal(
    result.current.answers['sec2-q1']?.state,
    ANSWER_STATE.NOT_ANSWERED,
    'on entering a section',
  );
});

/** The failure this prevents: a reload drawing section one before the server says it closed, then banking a visit there. */
test('a reload into a later section banks nothing on the closed one it drew first', async (t) => {
  let seed: (held: unknown) => void = () => {};
  const api = {
    me: {
      attemptState: () => new Promise((resolve) => (seed = resolve)),
      saveAttemptState: async (_id: string, body: SaveCall) => ({
        revision: body.revision,
        applied: true,
        endsAt: paper().endsAt,
        serverNow: paper().serverNow,
      }),
    },
  } as unknown as AppApiClient;
  const { result, unmount } = mounted(api);
  t.after(unmount);
  assert.equal(result.current.sectionId, 'sec1');

  await act(async () => {
    seed({
      answers: {},
      sections: {
        sec1: { remainingSec: 0, closed: true },
        sec2: { remainingSec: 900, closed: false, openedAt: '2026-09-01T04:50:00.000Z' },
      },
      revision: 3,
    });
    await Promise.resolve();
  });

  assert.equal(result.current.sectionId, 'sec2');
  assert.equal(result.current.answers['sec1-q1'], undefined);
});

/** A seed held back until the test lets it land, so a tap can come first. */
function apiSeededLater() {
  let seed: (held: unknown) => void = () => {};
  const api = {
    me: {
      attemptState: () => new Promise((resolve) => (seed = resolve)),
      saveAttemptState: async (_id: string, body: SaveCall) => ({
        revision: body.revision,
        applied: true,
        endsAt: paper().endsAt,
        serverNow: paper().serverNow,
      }),
    },
  } as unknown as AppApiClient;
  return { api, land: (held: unknown) => seed(held) };
}

/** The failure this prevents: a choice made in the first instant landing on a section the server has closed. */
test('a sectional paper takes no answer until the server says which section is open', async (t) => {
  const { api, land } = apiSeededLater();
  const { result, unmount } = mounted(api);
  t.after(unmount);

  act(() => result.current.chooseOption('opt-early'));
  await act(async () => {
    land({
      answers: {},
      sections: {
        sec1: { remainingSec: 0, closed: true },
        sec2: { remainingSec: 900, closed: false, openedAt: '2026-09-01T04:50:00.000Z' },
      },
      revision: 3,
    });
    await Promise.resolve();
  });

  assert.equal(result.current.answers['sec1-q1'], undefined);
  assert.equal(result.current.hasUnsent(), false);
});

test('a paper this screen just started takes an answer at once', (t) => {
  const { api } = apiSeededLater();
  const started = { ...paper(), timerTemplate: TIMER_TEMPLATE.COMPOSITE_FREE };
  const { result, unmount } = mounted(api, started, () => {}, true);
  t.after(unmount);

  assert.equal(result.current.locked, null, 'nothing is waited for on a paper just started');
  act(() => result.current.chooseOption('opt-early'));

  assert.equal(result.current.answers['sec1-q1']?.selectedOptionId, 'opt-early');
});

/** The failure this prevents: a tap on a reopened paper, drawn blank, replacing the saved answer, its flag and its time. */
test('a reopened paper takes no answer, move or submit until its saved state has arrived', async (t) => {
  const { api, land } = apiSeededLater();
  const { result, unmount } = mounted(api, {
    ...paper(),
    timerTemplate: TIMER_TEMPLATE.COMPOSITE_FREE,
    questions: [...paper().questions, { ...questionFor('sec1', 4), questionId: 'sec1-q2' }],
  });
  t.after(unmount);

  act(() => result.current.chooseOption('opt-early'));
  act(() => result.current.nextQuestion());
  act(() => result.current.submit.ask());
  assert.equal(result.current.question?.questionId, 'sec1-q1', 'the seat did not move');
  assert.equal(result.current.submit.asking, false, 'nothing is counted off a paper not yet drawn');
  assert.equal(result.current.locked, PAPER_LOCK.WAITING, 'and the screen is told why');
  assert.equal(result.current.canOpen('sec1-q2'), false, 'so no seat is drawn as open');

  const saved = {
    state: ANSWER_STATE.ANSWERED_MARKED,
    selectedOptionId: 'opt-saved',
    typedAnswer: null,
    timeSpentSec: 120,
    answeredAt: '2026-09-01T05:10:00.000Z',
    firstActionAt: '2026-09-01T05:09:00.000Z',
  };
  await act(async () => {
    land({ answers: { 'sec1-q1': saved }, sections: {}, revision: 4 });
    await Promise.resolve();
  });
  assert.deepEqual(result.current.answers['sec1-q1'], saved, 'what the server held is drawn whole');
  assert.equal(result.current.hasUnsent(), false);

  assert.equal(result.current.locked, null);
  act(() => result.current.chooseOption('opt-now'));
  act(() => result.current.submit.ask());
  assert.equal(result.current.selectedOptionId, 'opt-now', 'from here the paper is live');
  assert.equal(result.current.marked, true, 'and an answer keeps the flag it could not see before');
  assert.equal(result.current.submit.asking, true);
});

/** The failure this prevents: a forward-only reload drawn on seat one, where Next reopens seats already left. */
test('a forward-only reload lands on the furthest seat, whatever was tapped while it loaded', async (t) => {
  const { api, land } = apiSeededLater();
  const { result, unmount } = mounted(api, {
    ...paper(),
    timerTemplate: TIMER_TEMPLATE.COMPOSITE_FREE,
    navigation: NAVIGATION_POLICY.FORWARD_ONLY,
    questions: [
      ...paper().questions,
      { ...questionFor('sec1', 4), questionId: 'sec1-q2' },
      { ...questionFor('sec1', 5), questionId: 'sec1-q3' },
    ],
  });
  t.after(unmount);

  act(() => result.current.nextQuestion());

  const left = {
    state: ANSWER_STATE.NOT_ANSWERED,
    selectedOptionId: null,
    typedAnswer: null,
    timeSpentSec: 30,
    answeredAt: null,
    firstActionAt: '2026-09-01T05:01:00.000Z',
  };
  await act(async () => {
    land({
      answers: { 'sec1-q1': left, 'sec1-q2': left, 'sec1-q3': left },
      sections: {},
      revision: 4,
    });
    await Promise.resolve();
  });

  assert.equal(result.current.question?.questionId, 'sec1-q3');
});

/** The failure this prevents: a state read that never answers leaving a reopened one-clock paper dead until it is reloaded. */
test('a reopened one-clock paper waits on its saved state only as long as a save is given', async (t) => {
  mock.timers.enable({ apis: ['setTimeout'] });
  const { api, land } = apiSeededLater();
  const { result, unmount } = mounted(api, {
    ...paper(),
    timerTemplate: TIMER_TEMPLATE.COMPOSITE_FREE,
    questions: [...paper().questions, { ...questionFor('sec1', 4), questionId: 'sec1-q2' }],
  });
  t.after(() => {
    unmount();
    mock.timers.reset();
  });

  await advance(SAVE_TIMEOUT_MS - 250);
  act(() => result.current.chooseOption('opt-waiting'));
  assert.equal(result.current.answers['sec1-q1'], undefined, 'held for the whole of the wait');

  await advance(250);
  act(() => result.current.chooseOption('opt-waited'));
  act(() => result.current.submit.ask());
  assert.equal(result.current.selectedOptionId, 'opt-waited', 'then live on what the device holds');
  assert.equal(result.current.submit.asking, true);

  const saved = {
    state: ANSWER_STATE.ANSWERED,
    selectedOptionId: 'opt-saved',
    typedAnswer: null,
    timeSpentSec: 60,
    answeredAt: '2026-09-01T05:10:00.000Z',
    firstActionAt: '2026-09-01T05:09:00.000Z',
  };
  await act(async () => {
    land({ answers: { 'sec1-q1': saved, 'sec1-q2': saved }, sections: {}, revision: 4 });
    await Promise.resolve();
  });
  assert.equal(
    result.current.answers['sec1-q2']?.selectedOptionId,
    'opt-saved',
    'a late state is drawn',
  );
  assert.equal(result.current.selectedOptionId, 'opt-waited', 'under what was answered since');
});

/** The failure this prevents: a sectional paper released without its state, stamping a closed section as entered again. */
test('a reopened sectional paper stays held however long its saved state takes', async (t) => {
  mock.timers.enable({ apis: ['setTimeout'] });
  const { api } = apiSeededLater();
  const { result, unmount } = mounted(api);
  t.after(() => {
    unmount();
    mock.timers.reset();
  });

  await advance(SAVE_TIMEOUT_MS + 1_000);
  act(() => result.current.chooseOption('opt-waited'));

  assert.equal(result.current.answers['sec1-q1'], undefined);
  assert.equal(result.current.hasUnsent(), false, 'and no section was stamped as entered');
});

/** The failure this prevents: the wait outliving the state it waited for, a timer firing on a paper already live. */
test('a saved state that lands inside the wait opens the paper at once and leaves no wait behind', async (t) => {
  mock.timers.enable({ apis: ['setTimeout'] });
  const { api, land } = apiSeededLater();
  const deps = depsFor(api);
  const held = {
    paper: { ...paper(), timerTemplate: TIMER_TEMPLATE.COMPOSITE_FREE },
    arrivedAt: Date.now(),
    startedByThisCall: false,
    title: null,
    watermark: '',
    onEnded() {},
  };
  let renders = 0;
  const { result, unmount } = renderHook(
    () => {
      renders += 1;
      return useExamView(held, deps);
    },
    {
      wrapper: ({ children }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    },
  );
  t.after(() => {
    unmount();
    mock.timers.reset();
  });

  await act(async () => {
    land({ answers: {}, sections: {}, revision: 0 });
    await Promise.resolve();
  });
  act(() => result.current.chooseOption('opt-a'));
  assert.equal(result.current.selectedOptionId, 'opt-a', 'live as soon as the state is in');

  // Short of the earliest autosave, so the only thing that could fire here is a wait nobody stood down.
  const drawn = renders;
  await advance(SAVE_TIMEOUT_MS + 1_000);
  assert.equal(renders, drawn, 'nothing fires on a paper that is already live');
});

/** The server's SAVE_GRACE_SEC: a last batch landing later than this past the deadline is dropped as late. */
const SUBMIT_GRACE_MS = 30_000;

/** A request with no answer, the way a real fetch rejects only once its signal aborts. */
const hangs = (signal: AbortSignal | undefined) =>
  new Promise<never>((_resolve, reject) =>
    signal?.addEventListener('abort', () =>
      reject(new AppException(ErrorCodes.INTERNAL, 'gone', { httpStatus: 0 })),
    ),
  );

type SubmitCall = {
  last?: { answers: { questionId: string; selectedOptionId?: string | null }[] };
  signal?: AbortSignal;
};
type RequestExtra = { signal?: AbortSignal };

function apiThatSubmits(submit: (call: SubmitCall, count: number) => Promise<unknown>) {
  const submits: SubmitCall[] = [];
  let saves = 0;
  const api = {
    me: {
      attemptState: async () => ({ answers: {}, sections: {}, revision: 0 }),
      saveAttemptState: (_id: string, _body: unknown, extra: RequestExtra) => {
        saves += 1;
        return hangs(extra.signal);
      },
      submitAttempt: (_id: string, body: SubmitCall, extra: RequestExtra) => {
        submits.push({ ...body, signal: extra.signal });
        return submit({ ...body, signal: extra.signal }, submits.length);
      },
    },
  } as unknown as AppApiClient;
  return { api, submits, saves: () => saves };
}

async function settle() {
  for (let turn = 0; turn < 10; turn += 1) await Promise.resolve();
}

/** Moves the clock in small steps, each promise chain run out before the next, so nothing leaves late. */
async function advance(ms: number, step = 250) {
  for (let spent = 0; spent < ms; spent += step) {
    await act(async () => {
      await settle();
      mock.timers.tick(step);
      await settle();
    });
  }
}

const carried = (submits: SubmitCall[]) =>
  submits.map((call) => call.last?.answers.map((change) => change.questionId));

const onePaperClock = (): ExamPaper => ({
  ...paper(),
  timerTemplate: TIMER_TEMPLATE.COMPOSITE_FREE,
});

/** The failure this prevents: a submit whose socket never answers holding the student on Submitting past the deadline. */
test('a submit the server never answers is given up and sent again, and the one that answers ends the sitting', async (t) => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const { api, submits } = apiThatSubmits((call, count) =>
    count === 1 ? hangs(call.signal) : Promise.resolve({ attemptId: 'attempt-1' }),
  );
  let ended = 0;
  const { result, unmount } = mounted(api, onePaperClock(), () => (ended += 1));
  t.after(() => {
    unmount();
    mock.timers.reset();
  });
  await act(async () => {
    await Promise.resolve();
  });

  act(() => result.current.chooseOption('opt-1'));
  act(() => result.current.timer.onExpire());
  await advance(SUBMIT_TIMEOUT_MS + submitRetryDelayMs(0));

  assert.equal(submits[0]?.signal?.aborted, true, 'the hung request was given up');
  assert.deepEqual(
    carried(submits),
    [['sec1-q1'], ['sec1-q1']],
    'the retry carried the batch again',
  );
  assert.equal(ended, 1, 'the answer to the retry ended the sitting');
});

/** The failure this prevents: the last retry of a hung submit leaving after the server stopped taking the last batch. */
test('a submit that never answers still starts three tries inside the grace, behind a hung save', async (t) => {
  // Every autosave 20s apart: one falls while the retries run.
  t.mock.method(Math, 'random', () => 0);
  mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const { api, submits, saves } = apiThatSubmits((call) => hangs(call.signal));
  const { result, unmount } = mounted(api, onePaperClock());
  t.after(() => {
    unmount();
    mock.timers.reset();
  });
  await act(async () => {
    await Promise.resolve();
  });

  act(() => result.current.chooseOption('opt-1'));
  await advance(autosaveDelayMs(Math.random));
  assert.equal(saves(), 1, 'a save is in the air at the deadline, and never answers');

  act(() => result.current.timer.onExpire());
  await advance(SUBMIT_GRACE_MS);
  assert.equal(submits.length, 3, 'three tries left inside the grace');
  assert.equal(saves(), 1, 'nothing saved between them');

  await advance(SUBMIT_TIMEOUT_MS * 2);
  assert.equal(submits.length, 4, 'the first try and its three retries');
  assert.equal(saves(), 1, 'the autosave that fell between the last two sent nothing');

  await advance(autosaveDelayMs(Math.random));
  assert.equal(result.current.submit.failed, true, 'then given up for good');
  assert.equal(saves(), 2, 'saving picks up again once the paper has given up');
});

/** Below: one field of the view per drive, so a dependency missing from the engine's memo fails here. */

const twoInSectionOne = (): ExamPaper => ({
  ...onePaperClock(),
  questions: [
    questionFor('sec1', 1),
    { ...questionFor('sec1', 2), questionId: 'sec1-q2' },
    questionFor('sec2', 3),
    questionFor('sec3', 4),
  ],
});

/** A save held open, so the screen can be read while it is in the air and again once it lands. */
function apiGatedSave() {
  let settle = {
    saved: (_result: unknown) => {},
    refused: (_error: unknown) => {},
  };
  const api = {
    me: {
      attemptState: async () => ({ answers: {}, sections: {}, revision: 0 }),
      saveAttemptState: () =>
        new Promise((resolve, reject) => {
          settle = { saved: resolve, refused: reject };
        }),
      submitAttempt: async () => ({ attemptId: 'attempt-1' }),
    },
  } as unknown as AppApiClient;
  return {
    api,
    saved: (result: unknown) => settle.saved(result),
    refused: (error: unknown) => settle.refused(error),
  };
}

async function seated(
  api: AppApiClient,
  sitting: ExamPaper,
  onEnded?: (ended: EndedSitting) => void,
) {
  const held = mounted(api, sitting, onEnded);
  await act(async () => {
    await settle();
  });
  return held;
}

test('answering moves the answer, the palette and the flag the bottom bar draws', async (t) => {
  const { result, unmount } = await seated(apiWith({}), twoInSectionOne());
  t.after(unmount);

  assert.equal(result.current.selectedOptionId, null);
  assert.equal(result.current.marked, false);
  assert.equal(result.current.counts[ANSWER_STATE.ANSWERED], 0);
  assert.equal(result.current.submit.unanswered, 4);

  act(() => result.current.chooseOption('opt-a'));

  assert.equal(result.current.selectedOptionId, 'opt-a');
  assert.equal(result.current.answers['sec1-q1']?.selectedOptionId, 'opt-a');
  assert.equal(result.current.counts[ANSWER_STATE.ANSWERED], 1);
  assert.equal(result.current.sectionCounts('sec1')[ANSWER_STATE.ANSWERED], 1);
  assert.equal(result.current.submit.unanswered, 3, 'the confirm counts one fewer');

  act(() => result.current.markAndNext());
  act(() => result.current.openQuestion('sec1-q1'));

  assert.equal(result.current.marked, true);
  assert.equal(result.current.submit.markedForReview, 1);

  act(() => result.current.clearResponse());
  assert.equal(result.current.selectedOptionId, null, 'clearing takes the option off the screen');
});

test('moving on swaps the question, its seat number and what that seat holds', async (t) => {
  const { result, unmount } = await seated(apiWith({}), twoInSectionOne());
  t.after(unmount);

  assert.equal(result.current.question?.questionId, 'sec1-q1');
  assert.equal(result.current.questionIndex, 0);

  act(() => result.current.chooseOption('opt-a'));
  act(() => result.current.nextQuestion());

  assert.equal(result.current.question?.questionId, 'sec1-q2');
  assert.equal(result.current.questionIndex, 1);
  assert.equal(result.current.selectedOptionId, null, 'the new seat carries no answer');
  assert.equal(result.current.canOpen('sec1-q1'), true);
});

test('opening another section swaps the section and the questions under it', async (t) => {
  const { result, unmount } = await seated(apiWith({}), twoInSectionOne());
  t.after(unmount);

  assert.equal(result.current.sectionId, 'sec1');
  assert.deepEqual(
    result.current.questions.map((row) => row.questionId),
    ['sec1-q1', 'sec1-q2'],
  );

  await act(async () => {
    result.current.openSection('sec2');
    await settle();
  });

  assert.equal(result.current.sectionId, 'sec2');
  assert.deepEqual(
    result.current.questions.map((row) => row.questionId),
    ['sec2-q1'],
  );
  assert.equal(result.current.question?.questionId, 'sec2-q1');
});

/** The failure this prevents: the bell ringing on a section while the screen still draws the one behind it. */
test("a section's clock running out moves the sitting on, and the whole view with it", async (t) => {
  // A save that never answers, so no new clock lands and the section is the only thing that moved.
  const { result, unmount } = await seated(apiGatedSave().api, paper());
  t.after(unmount);

  assert.deepEqual(result.current.reachable, ['sec1']);
  assert.equal(
    result.current.timer.kind === TIMER_KIND.SECTION && result.current.timer.key,
    'sec1',
  );

  await act(async () => {
    result.current.timer.onExpire();
    await settle();
  });

  assert.deepEqual(result.current.reachable, ['sec2'], 'the section behind is shut');
  assert.equal(result.current.sectionId, 'sec2');
  assert.equal(
    result.current.timer.kind === TIMER_KIND.SECTION && result.current.timer.key,
    'sec2',
  );
  assert.deepEqual(
    result.current.questions.map((row) => row.questionId),
    ['sec2-q1'],
  );
});

test('a save in the air says Saving, and the clock it answers with reaches the timer', async (t) => {
  mock.timers.enable({ apis: ['setTimeout'] });
  const { api, saved } = apiGatedSave();
  const { result, unmount } = await seated(api, onePaperClock());
  t.after(() => {
    unmount();
    mock.timers.reset();
  });

  act(() => result.current.chooseOption('opt-a'));
  assert.equal(result.current.isSaving, false);

  await act(async () => {
    mock.timers.tick(31_000);
    await settle();
  });
  assert.equal(result.current.isSaving, true, 'the save is in the air');

  const extended = '2026-09-01T08:00:00.000Z';
  await act(async () => {
    saved({ revision: 1, applied: true, endsAt: extended, serverNow: paper().serverNow });
    await settle();
  });

  assert.equal(result.current.isSaving, false);
  assert.equal(result.current.hasUnsaved, false);
  assert.equal(
    result.current.timer.kind === TIMER_KIND.PAPER && result.current.timer.clock.endsAt,
    extended,
    'an extension reaches the timer without a reload',
  );
});

/** Drives one refused save and hands back the screen it left behind. */
async function afterRefusedSave(t: TestContext, error: unknown) {
  const { api, refused } = apiGatedSave();
  const { result, unmount } = await seated(api, onePaperClock());
  t.after(unmount);

  act(() => result.current.chooseOption('opt-a'));
  act(() => result.current.openSection('sec2'));
  await act(async () => {
    refused(error);
    await settle();
  });
  return result;
}

test('a refused save raises the unsaved warning and leaves the sitting standing', async (t) => {
  const result = await afterRefusedSave(
    t,
    new AppException(ErrorCodes.INTERNAL, 'nope', { httpStatus: 500 }),
  );

  assert.equal(result.current.hasUnsaved, true);
  assert.equal(result.current.takenOver, false);
  assert.equal(result.current.setAside, false);
});

test('a save refused because the sitting went elsewhere stands this tab down', async (t) => {
  const result = await afterRefusedSave(
    t,
    new AppException(ErrorCodes.SITTING_TAKEN_OVER, 'elsewhere', { httpStatus: 409 }),
  );

  assert.equal(result.current.takenOver, true);
  assert.equal(result.current.setAside, false, 'this test went elsewhere; no other test took it');
});

test('a save refused because another test was opened sets this one aside', async (t) => {
  const result = await afterRefusedSave(
    t,
    new AppException(ErrorCodes.SITTING_SET_ASIDE, 'another test', { httpStatus: 409 }),
  );

  assert.equal(result.current.takenOver, true);
  assert.equal(result.current.setAside, true);
});

test('asking to submit, cancelling, then confirming ends the sitting', async (t) => {
  let answer: (done: unknown) => void = () => {};
  const api = {
    me: {
      attemptState: async () => ({ answers: {}, sections: {}, revision: 0 }),
      saveAttemptState: async () => ({ revision: 0, applied: true }),
      submitAttempt: () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    },
  } as unknown as AppApiClient;
  let ended = 0;
  const { result, unmount } = mounted(api, onePaperClock(), () => (ended += 1));
  // Answered whatever the assertions do, so a failure fails rather than hanging on a paper still in the air.
  t.after(() => {
    answer({ attemptId: 'attempt-1' });
    unmount();
  });
  await act(async () => {
    await settle();
  });

  assert.equal(result.current.submit.asking, false);
  act(() => result.current.submit.ask());
  assert.equal(result.current.submit.asking, true);
  act(() => result.current.submit.cancel());
  assert.equal(result.current.submit.asking, false);

  act(() => result.current.submit.ask());
  await act(async () => {
    result.current.submit.confirm();
    await settle();
  });

  assert.equal(result.current.submit.asking, false, 'confirming closes the question');
  assert.equal(result.current.submit.isPending, true, 'the paper is going in');

  await act(async () => {
    answer({ attemptId: 'attempt-1' });
    await settle();
  });
  assert.equal(ended, 1);
});

test('a submit refused for good says so, and the retry sends it again', async (t) => {
  let tries = 0;
  const api = {
    me: {
      attemptState: async () => ({ answers: {}, sections: {}, revision: 0 }),
      saveAttemptState: async () => ({ revision: 0, applied: true }),
      submitAttempt: async () => {
        tries += 1;
        throw new AppException(ErrorCodes.INTERNAL, 'refused', { httpStatus: 400 });
      },
    },
  } as unknown as AppApiClient;
  const { result, unmount } = await seated(api, onePaperClock());
  t.after(unmount);

  assert.equal(result.current.submit.failed, false);
  await act(async () => {
    result.current.submit.confirm();
    await settle();
  });

  assert.equal(result.current.submit.failed, true);
  assert.equal(result.current.submit.isPending, false);
  assert.equal(tries, 1, 'a refusal the server meant is not retried behind the screen');

  await act(async () => {
    result.current.submit.retry();
    await settle();
  });
  assert.equal(tries, 2, 'the retry reached the paper');
});

/** Each step below moves ONE of the four, so none of them can be riding another's dependency. */
test('the fullscreen view carries the screen state and the exits it is nagging about', (t) => {
  const deps = depsFor(apiWith({}));
  const held = {
    paper: paper(),
    arrivedAt: Date.now(),
    startedByThisCall: false,
    title: null,
    watermark: '',
    onEnded() {},
  };
  const { result, rerender, unmount } = renderHook(
    ({ exits, isFullscreen }) =>
      useExamView(held, { ...deps, focus: { ...focus, isSupported: true, isFullscreen, exits } }),
    {
      initialProps: { exits: 0, isFullscreen: true },
      wrapper: ({ children }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    },
  );
  t.after(unmount);

  assert.equal(result.current.fullscreen.isSupported, true);
  assert.equal(result.current.fullscreen.isFullscreen, true);
  assert.equal(result.current.fullscreen.exits, 0);
  assert.equal(result.current.fullscreen.nagging, false);

  // Nothing has been left yet, so dropping out of full screen moves that flag and nothing else.
  rerender({ exits: 0, isFullscreen: false });
  assert.equal(result.current.fullscreen.isFullscreen, false);
  assert.equal(result.current.fullscreen.nagging, false);

  rerender({ exits: 1, isFullscreen: false });
  assert.equal(result.current.fullscreen.nagging, true);

  // Still nagging about the first exit, so only the count moves.
  rerender({ exits: 2, isFullscreen: false });
  assert.equal(result.current.fullscreen.exits, 2);
  assert.equal(result.current.fullscreen.nagging, true);

  act(() => result.current.fullscreen.ignore());
  assert.equal(result.current.fullscreen.nagging, false, 'acknowledged, and the count is kept');
  assert.equal(result.current.fullscreen.exits, 2);
});

/** The failure this prevents: the bell ringing and the screen never saying the paper is going in. */
test('the paper’s clock running out hands it in without asking', async (t) => {
  let going: (done: unknown) => void = () => {};
  const { api } = apiGatedSave();
  const held = {
    me: {
      ...(api as unknown as { me: object }).me,
      submitAttempt: () =>
        new Promise((resolve) => {
          going = resolve;
        }),
    },
  } as unknown as AppApiClient;
  const { result, unmount } = await seated(held, onePaperClock());
  // Answered whatever the assertions do, so a failure fails rather than hanging on a paper still in the air.
  t.after(() => {
    going({ attemptId: 'attempt-1' });
    unmount();
  });

  assert.equal(result.current.submit.isPending, false);
  assert.equal(result.current.submit.asking, false);

  await act(async () => {
    result.current.timer.onExpire();
    await settle();
  });

  assert.equal(result.current.submit.isPending, true, 'the paper is going in, unasked');
  assert.equal(result.current.submit.asking, false, 'the bell asks nobody');
});

/** The property the memo is bought for: nothing moved, so nothing downstream sees a new object. */
test('a render that changes nothing hands back the very same view', async (t) => {
  const { result, rerender, unmount } = await seated(apiWith({}), twoInSectionOne());
  t.after(unmount);

  const before = result.current;
  rerender();
  assert.equal(result.current, before, 'the view was not rebuilt');

  act(() => result.current.chooseOption('opt-a'));
  assert.notEqual(result.current, before, 'and it IS rebuilt the moment something moves');
});

/** The failure this prevents: the seat moving under a screen still drawing the question behind it. */
test('a seat change that banks nothing redraws the question on its own', async (t) => {
  // A state read the server refused releases the paper, and a bare visit is not banked on one never seeded.
  const api = {
    me: {
      attemptState: async () => {
        throw new AppException(ErrorCodes.NOT_FOUND);
      },
      saveAttemptState: async () => ({ revision: 0, applied: true }),
    },
  } as unknown as AppApiClient;
  const { result, unmount } = await seated(api, twoInSectionOne());
  t.after(unmount);

  const held = result.current.answers;
  act(() => result.current.nextQuestion());

  assert.equal(result.current.answers, held, 'nothing was banked, so only the seat moved');
  assert.equal(result.current.question?.questionId, 'sec1-q2');
  assert.equal(result.current.questionIndex, 1);
});

/** The failure this prevents: the submit dialog still standing over a sitting that went elsewhere. */
test('a sitting taken over while the submit dialog is up takes the dialog down with it', async (t) => {
  mock.timers.enable({ apis: ['setTimeout'] });
  const { api, refused } = apiGatedSave();
  const { result, unmount } = await seated(api, onePaperClock());
  t.after(() => {
    unmount();
    mock.timers.reset();
  });

  act(() => result.current.chooseOption('opt-a'));
  act(() => result.current.submit.ask());
  assert.equal(result.current.submit.asking, true);

  await act(async () => {
    mock.timers.tick(31_000);
    await settle();
  });
  await act(async () => {
    refused(new AppException(ErrorCodes.SITTING_TAKEN_OVER, 'elsewhere', { httpStatus: 409 }));
    await settle();
  });

  assert.equal(result.current.takenOver, true);
  assert.equal(
    result.current.submit.asking,
    false,
    'nothing is asked of a tab that no longer holds it',
  );
});

/** The failure this prevents: the last bell leaving a section still drawn as open behind the submit. */
test('the last section closing leaves none reachable and hands the paper in', async (t) => {
  let tries = 0;
  const api = {
    me: {
      attemptState: async () => ({
        answers: {},
        sections: {
          sec1: { remainingSec: 0, closed: true },
          sec2: { remainingSec: 0, closed: true },
          sec3: { remainingSec: 600, closed: false, openedAt: '2026-09-01T04:50:00.000Z' },
        },
        revision: 0,
      }),
      saveAttemptState: async () => ({ revision: 0, applied: true }),
      submitAttempt: async () => {
        tries += 1;
        return { attemptId: 'attempt-1' };
      },
    },
  } as unknown as AppApiClient;
  const { result, unmount } = await seated(api, paper());
  t.after(unmount);

  assert.deepEqual(result.current.reachable, ['sec3']);

  act(() => result.current.timer.onExpire());
  assert.deepEqual(result.current.reachable, [], 'no section is open once the last one shuts');

  await act(async () => {
    await settle();
  });
  assert.equal(tries, 1, 'and the paper went in');
});

/** The failure this prevents: an OMR bubble writing through a stale seat, so the mark lands on the wrong question. */
test('a filled bubble answers this seat and moves on; a smudge does neither', async (t) => {
  const { result, unmount } = await seated(apiWith({}), twoInSectionOne());
  t.after(unmount);

  act(() => result.current.bubbleAnswer('opt-a', OMR_FILL.PARTIAL));
  assert.equal(result.current.question?.questionId, 'sec1-q1', 'a half fill stays put');
  assert.equal(result.current.selectedOptionId, 'opt-a');
  assert.equal(result.current.marked, true);

  act(() => result.current.bubbleAnswer('opt-b', OMR_FILL.FULL));
  assert.equal(result.current.question?.questionId, 'sec1-q2', 'a full bubble IS Save & Next');
  assert.equal(result.current.answers['sec1-q1']?.selectedOptionId, 'opt-b');

  const held = result.current.answers;
  act(() => result.current.bubbleAnswer('opt-c', 0.05));
  assert.equal(result.current.answers, held, 'a smudge writes nothing at all');
});

const refusedForGood = () =>
  Promise.reject(new AppException(ErrorCodes.INTERNAL, 'refused', { httpStatus: 400 }));

/** The failure this prevents: an answer given after the bell riding a retry inside the server's grace. */
test('once the paper’s clock has run out nothing more is taken, and a retry hands in none of it', async (t) => {
  const { api, submits } = apiThatSubmits(refusedForGood);
  const { result, unmount } = await seated(api, twoInSectionOne());
  t.after(unmount);

  act(() => result.current.chooseOption('opt-in-time'));
  await act(async () => {
    result.current.timer.onExpire();
    await settle();
  });
  assert.equal(result.current.submit.failed, true);
  assert.equal(result.current.locked, PAPER_LOCK.OUT_OF_TIME, 'and the screen is told why');

  act(() => result.current.chooseOption('opt-late'));
  act(() => result.current.openQuestion('sec1-q2'));
  act(() => result.current.openSection('sec2'));
  assert.equal(result.current.selectedOptionId, 'opt-in-time', 'the option on screen did not move');
  assert.equal(result.current.question?.questionId, 'sec1-q1', 'nor did the palette');
  assert.equal(result.current.sectionId, 'sec1', 'nor the section');

  await act(async () => {
    result.current.submit.retry();
    await settle();
  });
  assert.deepEqual(
    submits.at(-1)?.last?.answers.map((change) => [change.questionId, change.selectedOptionId]),
    [['sec1-q1', 'opt-in-time']],
    'the retry carried what was answered in time, and nothing since',
  );
});

/** The failure this prevents: time added to a stuck paper leaving a red box whose one button hands it in. */
test('time added to a paper that had run out opens it again and takes the failure down', async (t) => {
  mock.timers.enable({ apis: ['setTimeout'] });
  const api = {
    me: {
      attemptState: async () => ({ answers: {}, sections: {}, revision: 0 }),
      saveAttemptState: async (_id: string, body: SaveCall) => ({
        revision: body.revision,
        applied: true,
        endsAt: '2026-09-01T08:00:00.000Z',
        serverNow: paper().serverNow,
      }),
      submitAttempt: refusedForGood,
    },
  } as unknown as AppApiClient;
  const { result, unmount } = await seated(api, onePaperClock());
  t.after(() => {
    unmount();
    mock.timers.reset();
  });

  act(() => result.current.chooseOption('opt-a'));
  await act(async () => {
    result.current.timer.onExpire();
    await settle();
  });
  assert.equal(result.current.submit.failed, true);

  // The autosave is the only thing that brings a deadline back to the screen.
  await advance(31_000);

  assert.equal(result.current.submit.failed, false, 'nothing is owed on a paper with time left');
  assert.equal(result.current.locked, null);
  act(() => result.current.chooseOption('opt-b'));
  assert.equal(result.current.selectedOptionId, 'opt-b', 'and it takes answers again');
});

/** The failure this prevents: time arriving with the last save calling off a hand-in already going, or never opening the paper. */
test('time that arrives while the hand-in is in the air opens the paper only once that hand-in has failed', async (t) => {
  // Every autosave 20s apart, so one is in the air when the clock runs out.
  t.mock.method(Math, 'random', () => 0);
  mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const gate = apiGatedSave();
  let refuse: (error: unknown) => void = () => {};
  const api = {
    me: {
      ...(gate.api as unknown as { me: object }).me,
      submitAttempt: () =>
        new Promise((_resolve, reject) => {
          refuse = reject;
        }),
    },
  } as unknown as AppApiClient;
  const { result, unmount } = await seated(api, onePaperClock());
  t.after(() => {
    unmount();
    mock.timers.reset();
  });

  act(() => result.current.chooseOption('opt-a'));
  await advance(autosaveDelayMs(Math.random));
  act(() => result.current.timer.onExpire());
  await act(async () => {
    gate.saved({
      revision: 1,
      applied: true,
      endsAt: '2026-09-01T08:00:00.000Z',
      serverNow: paper().serverNow,
    });
    await settle();
  });
  await advance(500);

  act(() => result.current.chooseOption('opt-mid'));
  assert.equal(
    result.current.submit.isPending,
    true,
    'the hand-in already going is not called off',
  );
  assert.equal(result.current.selectedOptionId, 'opt-a', 'and nothing is taken beside it');

  await act(async () => {
    refuse(new AppException(ErrorCodes.INTERNAL, 'refused', { httpStatus: 400 }));
    await settle();
  });
  await advance(500);

  assert.equal(result.current.submit.failed, false, 'the paper has time, so no failure is owed');
  act(() => result.current.chooseOption('opt-b'));
  assert.equal(result.current.selectedOptionId, 'opt-b');
});

/** The failure this prevents: the last section's question still drawn, and answerable, under a failed hand-in. */
test('a last section that has closed draws no question and takes nothing while the hand-in fails', async (t) => {
  const api = {
    me: {
      attemptState: async () => ({
        answers: {},
        sections: {
          sec1: { remainingSec: 0, closed: true },
          sec2: { remainingSec: 0, closed: true },
          sec3: { remainingSec: 600, closed: false, openedAt: '2026-09-01T04:50:00.000Z' },
        },
        revision: 0,
      }),
      saveAttemptState: async () => ({ revision: 0, applied: true }),
      submitAttempt: refusedForGood,
    },
  } as unknown as AppApiClient;
  const twoInTheLast: ExamPaper = {
    ...paper(),
    questions: [...paper().questions, { ...questionFor('sec3', 4), questionId: 'sec3-q2' }],
  };
  const { result, unmount } = await seated(api, twoInTheLast);
  t.after(unmount);
  assert.equal(result.current.question?.questionId, 'sec3-q1');

  await act(async () => {
    result.current.timer.onExpire();
    await settle();
  });
  assert.equal(result.current.submit.failed, true);
  assert.equal(
    result.current.question,
    undefined,
    'a skin draws its closed message, not a question',
  );

  const held = result.current.answers;
  act(() => result.current.openQuestion('sec3-q2'));
  act(() => result.current.chooseOption('opt-late'));
  assert.equal(result.current.answers, held, 'neither the palette nor an option wrote anything');
});

const neverLanded = (httpStatus: number) => () =>
  Promise.reject(new AppException(ErrorCodes.INTERNAL, 'never landed', { httpStatus }));

/** The failure this prevents: a hand-in held untried while the browser says offline, with no failure and nothing to press. */
test('a hand-in is tried while the browser says offline, and its failure reaches the screen', async (t) => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  onlineManager.setOnline(false);
  const { api, submits } = apiThatSubmits(neverLanded(0));
  const { result, unmount } = mounted(api, onePaperClock());
  t.after(() => {
    unmount();
    onlineManager.setOnline(true);
    mock.timers.reset();
  });
  await act(async () => {
    await Promise.resolve();
  });

  act(() => result.current.submit.confirm());
  await advance(submitRetryDelayMs(0) + submitRetryDelayMs(1) + submitRetryDelayMs(2) + 1_000);

  assert.equal(submits.length, 4, 'the first try and its three retries all left');
  assert.equal(result.current.submit.failed, true, 'so there is a failure to show and to retry');
  assert.equal(result.current.submit.isPending, false);
});

/** The failure this prevents: the retries waiting for a hidden tab to be looked at while the server's grace runs out. */
test('a hand-in is retried at 1, 2 and 4 seconds while the tab is hidden', async (t) => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  focusManager.setFocused(false);
  const { api, submits } = apiThatSubmits(neverLanded(500));
  const { result, unmount } = mounted(api, onePaperClock());
  t.after(() => {
    unmount();
    focusManager.setFocused(undefined);
    mock.timers.reset();
  });
  await act(async () => {
    await Promise.resolve();
  });

  act(() => result.current.timer.onExpire());
  const leftBy: number[] = [];
  // Half a second past each try, so every count is read with that try's own wait still running.
  for (const wait of [500, submitRetryDelayMs(0), submitRetryDelayMs(1), submitRetryDelayMs(2)]) {
    await advance(wait);
    leftBy.push(submits.length);
  }

  assert.deepEqual(leftBy, [1, 2, 3, 4]);
});

/** The failure this prevents: an option tapped while the paper goes in, drawn and queued, then wiped when it lands. */
test('nothing is answered, moved or opened while the paper is going in, and the view says so', async (t) => {
  let refuse: (error: unknown) => void = () => {};
  const { api, submits } = apiThatSubmits(
    () =>
      new Promise((_resolve, reject) => {
        refuse = reject;
      }),
  );
  const { result, unmount } = await seated(api, twoInSectionOne());
  t.after(unmount);

  act(() => result.current.chooseOption('opt-before'));
  assert.equal(result.current.locked, null, 'an open paper is held by nothing');
  await act(async () => {
    result.current.submit.confirm();
    await settle();
  });
  assert.equal(result.current.locked, PAPER_LOCK.GOING_IN);
  assert.equal(result.current.canOpen('sec1-q2'), false, 'so no seat is drawn as open');

  act(() => result.current.chooseOption('opt-during'));
  act(() => result.current.clearResponse());
  act(() => result.current.openQuestion('sec1-q2'));
  act(() => result.current.openSection('sec2'));
  assert.equal(result.current.selectedOptionId, 'opt-before', 'the option on screen did not move');
  assert.equal(result.current.question?.questionId, 'sec1-q1', 'nor did the palette');
  assert.equal(result.current.sectionId, 'sec1', 'nor the section');

  await act(async () => {
    refuse(new AppException(ErrorCodes.INTERNAL, 'refused', { httpStatus: 400 }));
    await settle();
  });
  assert.equal(result.current.locked, null, 'a hand-in that failed with time left opens the paper');
  act(() => result.current.chooseOption('opt-after'));
  assert.equal(result.current.selectedOptionId, 'opt-after');
  assert.deepEqual(
    submits[0]?.last?.answers.map((change) => change.selectedOptionId),
    ['opt-before'],
    'the hand-in carried what was answered before it, and nothing since',
  );
});

/** The failure this prevents: a paper ended by the institute, or handed in elsewhere, answered on until its bell. */
test('a save refused because the sitting has ended stands the paper down, and its clock hands nothing in', async (t) => {
  let submits = 0;
  const api = {
    me: {
      attemptState: async () => ({ answers: {}, sections: {}, revision: 0 }),
      saveAttemptState: async () => {
        throw new AppException(ErrorCodes.SITTING_ENDED, 'ended', { httpStatus: 409 });
      },
      submitAttempt: async () => {
        submits += 1;
        return { attemptId: 'attempt-1' };
      },
    },
  } as unknown as AppApiClient;
  const { result, unmount } = await seated(api, onePaperClock());
  t.after(unmount);

  act(() => result.current.chooseOption('opt-a'));
  await act(async () => {
    result.current.openSection('sec2');
    await settle();
  });
  assert.equal(result.current.ended, true);
  assert.equal(result.current.takenOver, false, 'there is nothing here to continue');
  assert.equal(result.current.hasUnsaved, false);
  assert.equal(result.current.hasUnsent(), false, 'so leaving the page asks nothing');

  act(() => result.current.submit.ask());
  assert.equal(result.current.submit.asking, false);
  await act(async () => {
    result.current.timer.onExpire();
    await settle();
  });
  assert.equal(submits, 0, 'nothing more is sent, not even the hand-in');
});

/** The hand-in's reply for a paper answered once, as the server kept it. */
const handInReply = (over: Record<string, unknown> = {}) => ({
  attemptId: 'attempt-1',
  status: ATTEMPT_STATUS.SUBMITTED,
  submittedAt: '2026-09-01T06:00:00.000Z',
  submittedByThisCall: true,
  answeredCount: 1,
  ...over,
});

/** One paper answered once and handed in; what the screen is given to draw when the server replies. */
async function endedWith(t: TestContext, reply: unknown): Promise<EndedSitting | undefined> {
  const { api } = apiThatSubmits(() => Promise.resolve(reply));
  let ended: EndedSitting | undefined;
  const { result, unmount } = await seated(api, twoInSectionOne(), (sitting) => (ended = sitting));
  t.after(unmount);

  act(() => result.current.chooseOption('opt-a'));
  await act(async () => {
    result.current.submit.confirm();
    await settle();
  });
  return ended;
}

test('a hand-in the server counted as this device did is given its own summary to draw', async (t) => {
  // The second is a retry whose first try landed: the same paper, ended by an earlier call of this screen's.
  for (const reply of [handInReply(), handInReply({ submittedByThisCall: false })]) {
    const ended = await endedWith(t, reply);

    assert.equal(ended?.attemptId, 'attempt-1');
    assert.deepEqual(
      ended?.sections?.map((section) => [section.id, section.attempted, section.total]),
      [
        ['sec1', 1, 2],
        ['sec2', 0, 1],
        ['sec3', 0, 1],
      ],
    );
  }
});

/** The failure this prevents: Handed in drawing answers the server never kept, above what the score card will show. */
test('a hand-in the server counted differently, or set aside, is given no figures of its own', async (t) => {
  const kept = [
    handInReply({ answeredCount: 0, submittedByThisCall: false }),
    handInReply({ answeredCount: 2 }),
    handInReply({ status: ATTEMPT_STATUS.VOIDED, submittedByThisCall: false }),
  ];
  for (const reply of kept) {
    const ended = await endedWith(t, reply);

    assert.equal(ended?.attemptId, 'attempt-1', 'the screen is still sent on to the result');
    assert.equal(ended?.sections, null);
  }
});

/** The failure this prevents: a section stamped after the stand-down, so reloading the notice asks about unsaved changes. */
test('a sectional paper reopened after its sitting ended holds nothing unsent', async (t) => {
  const api = {
    me: {
      attemptState: async () => {
        throw new AppException(ErrorCodes.SITTING_ENDED, 'ended', { httpStatus: 409 });
      },
      saveAttemptState: async () => ({ revision: 0, applied: true }),
    },
  } as unknown as AppApiClient;
  const { result, unmount } = await seated(api, paper());
  t.after(unmount);

  assert.equal(result.current.ended, true);
  assert.equal(
    result.current.hasUnsent(),
    false,
    'no section is stamped on a sitting that is over',
  );
});

/** The student's own hand-in gone past a save still in the air, whose answer then says the sitting has ended. */
async function overtakenByOwnHandIn(t: TestContext) {
  // Every autosave 20s apart, so one is in the air when the paper is confirmed.
  t.mock.method(Math, 'random', () => 0);
  mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const gate = {
    refuseSave: (_error: unknown) => {},
    land: (_reply: unknown) => {},
    refuseHandIn: (_error: unknown) => {},
  };
  const api = {
    me: {
      attemptState: async () => ({ answers: {}, sections: {}, revision: 0 }),
      saveAttemptState: () =>
        new Promise((_resolve, reject) => {
          gate.refuseSave = reject;
        }),
      submitAttempt: () =>
        new Promise((resolve, reject) => {
          gate.land = resolve;
          gate.refuseHandIn = reject;
        }),
    },
  } as unknown as AppApiClient;
  let handedIn = 0;
  const { result, unmount } = mounted(api, onePaperClock(), () => (handedIn += 1));
  t.after(() => {
    unmount();
    mock.timers.reset();
  });
  await act(async () => {
    await settle();
  });

  act(() => result.current.chooseOption('opt-a'));
  await advance(autosaveDelayMs(Math.random));
  act(() => result.current.submit.confirm());
  // The hand-in waits this long on the save, then goes without it.
  await advance(FINISH_WAIT_MS + 1_000);
  assert.equal(result.current.submit.isPending, true);

  await act(async () => {
    gate.refuseSave(new AppException(ErrorCodes.SITTING_ENDED, 'ended', { httpStatus: 409 }));
    await settle();
  });
  return { result, gate, handedIn: () => handedIn };
}

/** The failure this prevents: "This test has ended" flashing over a paper the student has just handed in. */
test('a save refused as ended behind the student’s own hand-in does not say the test ended', async (t) => {
  const { result, gate, handedIn } = await overtakenByOwnHandIn(t);
  assert.equal(result.current.ended, false, 'the paper going in is this screen’s own');

  await act(async () => {
    gate.land(handInReply());
    await settle();
  });
  assert.equal(result.current.ended, false);
  assert.equal(handedIn(), 1, 'and Handed in opens as for any hand-in');
});

test('once that hand-in fails for good, the ended sitting is said', async (t) => {
  const { result, gate } = await overtakenByOwnHandIn(t);

  await act(async () => {
    gate.refuseHandIn(new AppException(ErrorCodes.INTERNAL, 'refused', { httpStatus: 400 }));
    await settle();
  });
  assert.equal(result.current.ended, true);
});
