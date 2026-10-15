import './support/offline';
import './support/assets';
import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { notifyManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import {
  ATTEMPT_STATUS,
  AppException,
  ErrorCodes,
  EXAM_TEMPLATE,
  LANGUAGE_CODE,
  LANGUAGE_MODE,
  NAVIGATION_POLICY,
  QUESTION_TYPE,
  TEST_UI,
  TIMER_TEMPLATE,
  type AnswerChange,
  type ExamPaper,
  type ExamTemplate,
  type StartedAttempt,
  type SubmittedAttempt,
} from '@iace/contracts';
import { autosaveDelayMs, SITTING_ENDED_SAYS } from '@iace/app-kit';
import { TooltipProvider } from '@iace/ui';
import { api } from '../src/lib/api';
import { ROUTES } from '../src/lib/constants';
import { AuthProvider } from '../src/providers/auth';

const { ExamPage } = await import('../src/features/exam/exam');

const TEST_ID = 'test_1';
const ATTEMPT_ID = 'att_1';
const STEM = 'What is two plus two?';
const NEXT_STEM = 'Which planet is red?';
const RIGHT = 'Four';
const WRONG = 'Five';
const LATER_SECTION = 'Reasoning';
const HANDED_IN = 'Handed in';
const REPORT = 'Report';
const RIGHT_OPTION_ID = 'q1-a';
const LONGEST_AUTOSAVE_MS = autosaveDelayMs(() => 1);

/** A skin's own words for handing the paper in, and for saying yes to it. */
const SKINS = {
  [EXAM_TEMPLATE.DEFAULT]: { submit: 'Submit', confirm: 'Submit' },
  [EXAM_TEMPLATE.RAILWAYS]: { submit: 'Submit', confirm: 'Yes' },
  [EXAM_TEMPLATE.BANKING]: { submit: 'SUBMIT', confirm: 'Submit' },
  [EXAM_TEMPLATE.SSC]: { submit: 'Submit', confirm: 'Submit Test' },
} as const satisfies Record<ExamTemplate, { submit: string; confirm: string }>;

const SKIN_NAMES = Object.keys(SKINS) as ExamTemplate[];

// Microtasks, not setTimeout(0): the autosave case mocks setTimeout, and a query's answer must still reach the screen.
notifyManager.setScheduler(queueMicrotask);

const text = (words: string) => [{ type: 'TEXT' as const, text: words }];

const question = (questionId: string, order: number, sectionId: string, stem: string) => ({
  questionId,
  order,
  baseConfigSectionId: sectionId,
  type: QUESTION_TYPE.SINGLE_MCQ,
  marks: 1,
  negativeMarks: 0,
  content: { en: { stem: text(stem) } },
  options: [RIGHT, WRONG].map((words, position) => ({
    id: `${questionId}-${position === 0 ? 'a' : 'b'}`,
    position,
    text: { en: text(words) },
  })),
});

const paper = (examTemplate: ExamTemplate): ExamPaper => ({
  attemptId: ATTEMPT_ID,
  endsAt: new Date(Date.now() + 3_600_000).toISOString(),
  serverNow: new Date().toISOString(),
  languages: [LANGUAGE_CODE.EN],
  languageMode: LANGUAGE_MODE.SINGLE,
  examTemplate,
  testUi: TEST_UI.CBT,
  timerTemplate: TIMER_TEMPLATE.COMPOSITE_FREE,
  navigation: NAVIGATION_POLICY.FREE,
  calculatorEnabled: false,
  sections: [
    { id: 'sec1', name: 'Quant', order: 1, questionCount: 2, durationSec: null },
    { id: 'sec2', name: LATER_SECTION, order: 2, questionCount: 1, durationSec: null },
  ],
  questions: [
    question('q1', 1, 'sec1', STEM),
    question('q2', 2, 'sec1', NEXT_STEM),
    question('q3', 3, 'sec2', 'Pick one.'),
  ],
});

const STARTED = {
  id: ATTEMPT_ID,
  testId: TEST_ID,
  languages: [LANGUAGE_CODE.EN],
  startedByThisCall: true,
  testTitle: 'Mock 1',
  paper: null,
} as unknown as StartedAttempt;

const SUBMITTED: SubmittedAttempt = {
  attemptId: ATTEMPT_ID,
  status: ATTEMPT_STATUS.SUBMITTED,
  submittedAt: new Date().toISOString(),
  submittedByThisCall: true,
  answeredCount: 1,
};

afterEach(() => {
  cleanup();
  mock.restoreAll();
  mock.timers.reset();
  sessionStorage.clear();
});

/** The server, answering as a fresh sitting does; `save` is what a save meets. */
function serve(examTemplate: ExamTemplate, save: () => Promise<unknown> = savedAll) {
  mock.method(api.me, 'startAttempt', () => Promise.resolve(STARTED));
  mock.method(api.me, 'attemptPaper', () => Promise.resolve(paper(examTemplate)));
  return {
    saves: mock.method(api.me, 'saveAttemptState', save),
    submits: mock.method(api.me, 'submitAttempt', () => Promise.resolve(SUBMITTED)),
  };
}

function savedAll() {
  const held = paper(EXAM_TEMPLATE.DEFAULT);
  return Promise.resolve({
    revision: 1,
    applied: true,
    endsAt: held.endsAt,
    serverNow: held.serverNow,
  });
}

function open() {
  const client = new QueryClient({
    defaultOptions: { queries: { gcTime: 0, retry: false }, mutations: { gcTime: 0 } },
  });
  render(
    <MemoryRouter initialEntries={[ROUTES.EXAM(TEST_ID)]}>
      <QueryClientProvider client={client}>
        <AuthProvider>
          <TooltipProvider>
            <Routes>
              <Route path={ROUTES.EXAM_PATTERN} element={<ExamPage />} />
              <Route path={ROUTES.SUBMITTED_PATTERN} element={<p>{HANDED_IN}</p>} />
              <Route path={ROUTES.REPORT_PATTERN} element={<p>{REPORT}</p>} />
            </Routes>
          </TooltipProvider>
        </AuthProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

/** Lets the queries and the saves land; `findBy` cannot, as it waits on the setTimeout the autosave case mocks. */
async function settle() {
  for (let turn = 0; turn < 10; turn += 1) await act(() => new Promise(setImmediate));
}

function chooseAndMoveOn() {
  fireEvent.click(screen.getByRole('radio', { name: new RegExp(RIGHT) }));
  fireEvent.click(screen.getByRole('button', { name: /save & next/i }));
}

/** A save sends its answers; a hand-in carries the unsent ones as `last`. */
type Sent = { answers?: AnswerChange[]; last?: { answers: AnswerChange[] } };

const carriesTheAnswer = (body: unknown) => {
  const sent = body as Sent;
  return (sent.answers ?? sent.last?.answers ?? []).some(
    (change) => change.questionId === 'q1' && change.selectedOptionId === RIGHT_OPTION_ID,
  );
};

for (const skin of SKIN_NAMES) {
  describe(`the exam page in the ${skin} skin`, () => {
    it('opens on the first question of the paper', async () => {
      serve(skin);
      open();

      assert.ok(await screen.findByText(STEM));
      assert.ok(screen.getByRole('radio', { name: new RegExp(RIGHT) }));
    });

    /** The failure this prevents: an answer that moved on with the student and never reached the server. */
    it('saves the chosen answer on the next autosave after Save & Next', async () => {
      mock.timers.enable({ apis: ['setTimeout'] });
      const { saves } = serve(skin);
      open();
      await settle();

      chooseAndMoveOn();
      await settle();
      assert.ok(screen.getByText(NEXT_STEM));

      mock.timers.tick(LONGEST_AUTOSAVE_MS);
      await settle();

      assert.ok(saves.mock.calls.some((call) => carriesTheAnswer(call.arguments[1])));
    });

    /** The failure this prevents: a skin's submit that asks and then never hands the paper in. */
    it('hands the paper in once through its own confirm, carrying the answer', async () => {
      const { submits } = serve(skin);
      open();
      await screen.findByText(STEM);
      chooseAndMoveOn();
      await screen.findByText(NEXT_STEM);

      fireEvent.click(screen.getByRole('button', { name: SKINS[skin].submit }));
      const asking = screen.queryByRole('alertdialog');
      const confirm = (asking ? within(asking) : screen).getAllByRole('button', {
        name: SKINS[skin].confirm,
      });
      fireEvent.click(confirm.at(-1) as HTMLElement);

      assert.ok(await screen.findByText(HANDED_IN));
      assert.equal(submits.mock.callCount(), 1);
      assert.equal(submits.mock.calls[0]?.arguments[0], ATTEMPT_ID);
      assert.ok(carriesTheAnswer(submits.mock.calls[0]?.arguments[1]));
    });
  });
}

describe('the exam page when the sitting stops', () => {
  /** The failure this prevents: two devices answering one sitting, each overwriting the other. */
  it('stands down when a save says another device took the sitting over', async () => {
    serve(EXAM_TEMPLATE.DEFAULT, () =>
      Promise.reject(new AppException(ErrorCodes.SITTING_TAKEN_OVER)),
    );
    open();
    await screen.findByText(STEM);

    fireEvent.click(screen.getByRole('radio', { name: new RegExp(RIGHT) }));
    fireEvent.mouseDown(screen.getByRole('tab', { name: LATER_SECTION }));

    assert.ok(await screen.findByRole('button', { name: 'Continue here' }));
    assert.equal(screen.queryByText(STEM), null);
  });

  /** The failure this prevents: a paper that ended elsewhere still taking answers that count for nothing. */
  it('shows the ended screen when a save says the sitting is over', async () => {
    serve(EXAM_TEMPLATE.DEFAULT, () => Promise.reject(new AppException(ErrorCodes.SITTING_ENDED)));
    open();
    await screen.findByText(STEM);

    fireEvent.click(screen.getByRole('radio', { name: new RegExp(RIGHT) }));
    fireEvent.mouseDown(screen.getByRole('tab', { name: LATER_SECTION }));

    assert.ok(await screen.findByText(SITTING_ENDED_SAYS.title));
    fireEvent.click(screen.getByRole('button', { name: 'See your result' }));
    assert.ok(await screen.findByText(REPORT));
  });
});

describe('the exam page when it cannot open', () => {
  it('offers Retry when the start is refused', async () => {
    const start = mock.method(api.me, 'startAttempt', () =>
      Promise.reject(new AppException(ErrorCodes.FORBIDDEN)),
    );
    open();

    assert.ok(await screen.findByText('This test could not be started'));
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await act(() => new Promise(setImmediate));
    assert.equal(start.mock.callCount(), 2);
  });

  it('says the paper did not load when its read fails', async () => {
    mock.method(api.me, 'startAttempt', () => Promise.resolve(STARTED));
    mock.method(api.me, 'attemptPaper', () =>
      Promise.reject(new AppException(ErrorCodes.NOT_FOUND)),
    );
    open();

    assert.ok(await screen.findByText('Your paper did not load'));
    assert.ok(screen.getByRole('button', { name: /retry/i }));
  });
});
