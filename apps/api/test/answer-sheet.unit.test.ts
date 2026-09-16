import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ANSWER_STATE, type LiveAnswer } from '@iace/contracts';
import {
  answeredIn,
  answersOf,
  blankSheet,
  decodeAnswer,
  encodeAnswer,
  servedSheet,
  sheetOf,
  timeSpentIn,
  verdictsOf,
} from '../src/attempts/answer-sheet';
import { displayOrder } from '../src/attempts/attempt-rules';

const STARTED = new Date('2026-09-01T05:00:00.000Z');
const OPTIONS = ['opt_a', 'opt_b', 'opt_c', 'opt_d'];
const at = (seconds: number) => new Date(STARTED.getTime() + seconds * 1000).toISOString();

const given = (over: Partial<LiveAnswer> = {}): LiveAnswer => ({
  state: ANSWER_STATE.ANSWERED,
  selectedOptionId: 'opt_c',
  typedAnswer: null,
  timeSpentSec: 42,
  firstActionAt: at(30),
  answeredAt: at(72),
  ...over,
});

const paper = [
  { questionId: 'q1', baseConfigSectionId: 's1', optionIds: OPTIONS },
  { questionId: 'q2', baseConfigSectionId: 's1', optionIds: OPTIONS },
  { questionId: 'q3', baseConfigSectionId: 's2', optionIds: [] },
];

describe('encodeAnswer / decodeAnswer', () => {
  it('stores a chosen option as its position and reads the same answer back', () => {
    const slot = encodeAnswer(given(), OPTIONS, STARTED);

    assert.deepEqual(slot, [2, 2, 42, 30, 72]);
    assert.deepEqual(decodeAnswer(slot, OPTIONS, STARTED), given());
  });

  it('keeps an option the paper row does not hold, so it reads back as that same choice', () => {
    const forged = given({ selectedOptionId: 'forged' });

    const slot = encodeAnswer(forged, OPTIONS, STARTED);

    assert.equal(slot[1], 'forged');
    assert.deepEqual(decodeAnswer(slot, OPTIONS, STARTED), forged);
  });

  it('carries a typed answer in a sixth place, and leaves the place off when there is none', () => {
    const typed = given({ selectedOptionId: null, typedAnswer: '42.5' });

    assert.deepEqual(encodeAnswer(typed, [], STARTED), [2, null, 42, 30, 72, '42.5']);
    assert.equal(encodeAnswer(given(), OPTIONS, STARTED).length, 5);
    assert.deepEqual(decodeAnswer(encodeAnswer(typed, [], STARTED), [], STARTED), typed);
  });

  it('keeps whole seconds after the start, dropping the milliseconds of an instant', () => {
    const slot = encodeAnswer(given({ answeredAt: '2026-09-01T05:01:12.987Z' }), OPTIONS, STARTED);

    assert.equal(slot[4], 72);
    assert.equal(decodeAnswer(slot, OPTIONS, STARTED)?.answeredAt, at(72));
  });

  it('reads a slot nobody touched as no answer at all', () => {
    assert.equal(decodeAnswer(null, OPTIONS, STARTED), null);
    assert.equal(decodeAnswer(undefined, OPTIONS, STARTED), null);
  });
});

describe('sheetOf / answersOf', () => {
  it('places each answer at its paper row and puts the same answers back', () => {
    const answers = { q2: given(), q3: given({ selectedOptionId: null, typedAnswer: '7' }) };

    const sheet = sheetOf(answers, paper, STARTED);

    assert.equal(sheet[0], null);
    assert.deepEqual(answersOf(sheet, paper, STARTED), answers);
  });

  it('ignores an answer to a question the paper does not hold', () => {
    assert.deepEqual(sheetOf({ elsewhere: given() }, paper, STARTED), blankSheet(3));
  });

  it('reads anything but an array as an untouched sheet', () => {
    assert.deepEqual(answersOf(null, paper, STARTED), {});
  });
});

describe('servedSheet', () => {
  it('serves the paper in the order the sitting saw it, an untouched row as not visited', () => {
    const sheet = sheetOf({ q2: given() }, paper, STARTED);

    const served = servedSheet(
      paper,
      { startedAt: STARTED, shuffleSeed: 9, sheet: { answers: sheet } },
      true,
    );

    assert.deepEqual(
      served.map((row) => row.questionId),
      displayOrder(paper, 9, true).map((row) => row.questionId),
    );
    assert.deepEqual(
      served.map((row) => row.order),
      [1, 2, 3],
    );
    const untouched = served.find((row) => row.questionId === 'q1');
    assert.deepEqual(
      [
        untouched?.state,
        untouched?.selectedOptionId,
        untouched?.timeSpentSec,
        untouched?.answeredAt,
      ],
      [ANSWER_STATE.NOT_VISITED, null, 0, null],
    );
    assert.deepEqual(served.find((row) => row.questionId === 'q2')?.answeredAt, new Date(at(72)));
  });

  it('attaches the scorer’s verdict to its row, and none before the sitting is scored', () => {
    const verdicts = [
      [true, 2],
      [false, -0.5],
      [null, 0],
    ];

    const scored = servedSheet(
      paper,
      { startedAt: STARTED, shuffleSeed: 1, sheet: { answers: [], verdicts } },
      false,
    );
    const unscored = servedSheet(paper, { startedAt: STARTED, shuffleSeed: 1, sheet: null }, false);

    assert.deepEqual(
      scored.map((row) => [row.questionId, row.isCorrect, row.marksAwarded]),
      [
        ['q1', true, 2],
        ['q2', false, -0.5],
        ['q3', null, 0],
      ],
    );
    assert.deepEqual(
      unscored.map((row) => [row.isCorrect, row.marksAwarded]),
      [
        [null, null],
        [null, null],
        [null, null],
      ],
    );
  });
});

describe('sheet totals', () => {
  it('sums the seconds and counts the answers a stored sheet holds', () => {
    const sheet = sheetOf(
      {
        q1: given({ timeSpentSec: 10 }),
        q2: given({
          state: ANSWER_STATE.MARKED_REVIEW,
          selectedOptionId: null,
          answeredAt: null,
          timeSpentSec: 5,
        }),
        q3: given({
          state: ANSWER_STATE.ANSWERED_MARKED,
          selectedOptionId: null,
          typedAnswer: '3',
          timeSpentSec: 1,
        }),
      },
      paper,
      STARTED,
    );

    assert.equal(timeSpentIn(sheet), 16);
    assert.equal(answeredIn(sheet), 2);
    assert.equal(timeSpentIn('not a sheet'), 0);
  });

  it('places the scorer’s marks at their paper rows, whatever order it scored them in', () => {
    const scores = [
      { questionId: 'q3', isCorrect: null, marksAwarded: 0 },
      { questionId: 'q1', isCorrect: true, marksAwarded: 2 },
    ];

    assert.deepEqual(verdictsOf(scores, paper), [
      [true, 2],
      [null, 0],
      [null, 0],
    ]);
  });
});
