import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  ANSWER_STATE,
  AppException,
  ErrorCodes,
  TIMER_TEMPLATE,
  type ExamPaper,
  type ExamQuestion,
  type SectionProgress,
} from '@iace/contracts';
import {
  TIMER_KIND,
  useExamView,
  type AppApiClient,
  type ExamEngineDeps,
  type FullscreenHandle,
} from '../src';
import { autosaveDelayMs, SUBMIT_TIMEOUT_MS, submitRetryDelayMs } from '../src/autosave-policy';
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

function mounted(api: AppApiClient, sitting: ExamPaper = paper(), onEnded = () => {}) {
  const deps = depsFor(api);
  return renderHook(
    () =>
      useExamView(
        { paper: sitting, arrivedAt: Date.now(), title: null, watermark: '', onEnded },
        deps,
      ),
    {
      wrapper: ({ children }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    },
  );
}

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
        { paper: paper(), arrivedAt: Date.now(), title: null, watermark: '', onEnded: () => {} },
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

test('a paper under one clock takes an answer at once, before the server has answered', (t) => {
  const { api } = apiSeededLater();
  const { result, unmount } = mounted(api, {
    ...paper(),
    timerTemplate: TIMER_TEMPLATE.COMPOSITE_FREE,
  });
  t.after(unmount);

  act(() => result.current.chooseOption('opt-early'));

  assert.equal(result.current.answers['sec1-q1']?.selectedOptionId, 'opt-early');
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

type SubmitCall = { last?: { answers: { questionId: string }[] }; signal?: AbortSignal };
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
