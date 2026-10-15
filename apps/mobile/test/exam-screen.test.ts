import test from 'node:test';
import assert from 'node:assert/strict';
import { AppException, ErrorCodes } from '@iace/contracts';
import {
  backAsksToSubmit,
  EXAM_ENTRY,
  examEntry,
  SITTING_COVER,
  SITTING_SCREEN,
  sittingScreen,
  type SittingFacts,
} from '../src/lib/exam-screen';

const SITTING = 'att_1';
const LIVE = { takenOver: false, ended: false };
const TAKEN_OVER = { takenOver: true, ended: false };
const ENDED = { takenOver: false, ended: true };

const facts = (over: Partial<SittingFacts> = {}): SittingFacts => ({
  startError: null,
  paperFailed: false,
  view: null,
  ...over,
});

/** The failure this prevents: a typing paper started on a phone, its clock running on a test that cannot be sat. */
test('examEntry refuses a keyboard paper before anything else, and waits only on a brief still loading', () => {
  const cases = [
    { isPending: false, needsKeyboard: true, want: EXAM_ENTRY.NEEDS_KEYBOARD },
    { isPending: true, needsKeyboard: false, want: EXAM_ENTRY.WAIT },
    { isPending: false, needsKeyboard: false, want: EXAM_ENTRY.SIT },
    // A brief that failed to load lands here too: it is no reason to keep anyone from an ordinary paper.
  ];
  for (const { want, ...brief } of cases)
    assert.equal(examEntry(brief), want, JSON.stringify(brief));
});

/** The failure this prevents: a resumed sitting handed in elsewhere restarted as a fresh paper. */
test('sittingScreen sends a resume the server says has ended to its submitted screen', () => {
  const ended = new AppException(ErrorCodes.SITTING_ENDED);
  assert.deepEqual(sittingScreen(facts({ startError: ended, resume: SITTING })), {
    screen: SITTING_SCREEN.HANDED_IN,
    attemptId: SITTING,
  });
  assert.deepEqual(
    sittingScreen(facts({ startError: ended })),
    { screen: SITTING_SCREEN.START_REFUSED },
    'a fresh start has no sitting to send them to',
  );
});

/** The failure this prevents: a paper held on another device read as an outage, or retried as a new start. */
test('sittingScreen tells a start refused for another device apart from one that failed', () => {
  const cases = [
    [new AppException(ErrorCodes.SITTING_HELD_ELSEWHERE), SITTING_SCREEN.HELD_ELSEWHERE],
    [new AppException(ErrorCodes.SITTING_HELD_ELSEWHERE), SITTING_SCREEN.HELD_ELSEWHERE, SITTING],
    [new AppException(ErrorCodes.INTERNAL), SITTING_SCREEN.START_REFUSED],
    [new AppException(ErrorCodes.FORBIDDEN), SITTING_SCREEN.START_REFUSED, SITTING],
    [new Error('socket hang up'), SITTING_SCREEN.START_REFUSED],
    [{ code: ErrorCodes.SITTING_ENDED }, SITTING_SCREEN.START_REFUSED, SITTING],
  ] as const;
  for (const [startError, want, resume] of cases) {
    assert.deepEqual(sittingScreen(facts({ startError, resume })), { screen: want }, String(want));
  }
});

/** The failure this prevents: a start that failed drawn as a live paper because a paper or view lingered. */
test('sittingScreen puts a failed start ahead of the paper and the view', () => {
  const shown = sittingScreen(
    facts({ startError: new AppException(ErrorCodes.INTERNAL), paperFailed: true, view: ENDED }),
  );
  assert.deepEqual(shown, { screen: SITTING_SCREEN.START_REFUSED });
});

/** The failure this prevents: a paper that did not arrive drawn as an empty sitting with its clock running. */
test('sittingScreen shows a paper that failed to load as a failure', () => {
  assert.deepEqual(sittingScreen(facts({ paperFailed: true, startedId: SITTING, view: LIVE })), {
    screen: SITTING_SCREEN.PAPER_FAILED,
  });
});

/** The failure this prevents: a stood-down device still taking answers, or an ended paper offered Continue here. */
test('sittingScreen covers a live sitting by what stood it down', () => {
  const cases = [
    { view: null, startedId: SITTING, want: { cover: SITTING_COVER.NONE } },
    { view: LIVE, startedId: SITTING, want: { cover: SITTING_COVER.NONE } },
    { view: TAKEN_OVER, startedId: SITTING, want: { cover: SITTING_COVER.TAKEN_OVER } },
    { view: ENDED, startedId: SITTING, want: { cover: SITTING_COVER.ENDED, attemptId: SITTING } },
    {
      view: { takenOver: true, ended: true },
      startedId: SITTING,
      want: { cover: SITTING_COVER.ENDED, attemptId: SITTING },
    },
    { view: ENDED, startedId: undefined, want: { cover: SITTING_COVER.NONE } },
    {
      view: { takenOver: true, ended: true },
      startedId: undefined,
      want: { cover: SITTING_COVER.TAKEN_OVER },
    },
  ];
  for (const { view, startedId, want } of cases) {
    assert.deepEqual(
      sittingScreen(facts({ view, startedId })),
      { screen: SITTING_SCREEN.LIVE, ...want },
      JSON.stringify({ view, startedId }),
    );
  }
});

/** The failure this prevents: Back dropping a running paper, or trapping a student on one already stood down. */
test('backAsksToSubmit holds Back only while the paper is live on this device', () => {
  assert.equal(backAsksToSubmit(LIVE), true);
  assert.equal(backAsksToSubmit(null), false, 'no paper yet');
  assert.equal(backAsksToSubmit(TAKEN_OVER), false);
  assert.equal(backAsksToSubmit(ENDED), false);
});
