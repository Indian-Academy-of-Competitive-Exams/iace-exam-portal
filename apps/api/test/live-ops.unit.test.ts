import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ANSWER_STATE, EVALUATION_MODE, TEST_STATUS, type LiveAnswer } from '@iace/contracts';
import {
  answeredCountOf,
  sittingsFrom,
  watchableTestsWhere,
  type SittingRow,
} from '../src/attempts/live-ops';
import { type HeldState } from '../src/attempts/attempt-state';

const STARTED_AT = new Date('2026-09-09T09:30:00.000Z');
const ENDS_AT = new Date('2026-09-09T10:30:00.000Z');

const QUESTION_COUNT = 100;

/** Every key gone: what an ops screen sees when Redis has lost a hall's live state. */
const NO_LIVE_STATE = new Map<string, HeldState>();

function answer(state: LiveAnswer['state']): LiveAnswer {
  return {
    state,
    selectedOptionId: state === ANSWER_STATE.NOT_VISITED ? null : 'o1',
    typedAnswer: null,
    timeSpentSec: 10,
    answeredAt: null,
  };
}

function held(over: Partial<HeldState> = {}): HeldState {
  return {
    attemptId: 'att_1',
    studentId: 'stu_1',
    endsAt: ENDS_AT.toISOString(),
    revision: 3,
    answers: {},
    sections: {},
    ...over,
  };
}

function sitting(over: Partial<SittingRow> = {}): SittingRow {
  return {
    id: 'att_1',
    studentId: 'stu_1',
    attemptNo: 1,
    isGraded: true,
    startedAt: STARTED_AT,
    endsAt: ENDS_AT,
    student: { fullName: 'Asha', mobile: '9876543210', currentBranch: { name: 'Ameerpet' } },
    ...over,
  };
}

describe('live ops — what a sitting looks like from the outside', () => {
  it('counts an answer as answered whether or not it is also marked for review', () => {
    const state = held({
      answers: {
        q1: answer(ANSWER_STATE.ANSWERED),
        q2: answer(ANSWER_STATE.ANSWERED_MARKED),
        q3: answer(ANSWER_STATE.MARKED_REVIEW),
        q4: answer(ANSWER_STATE.NOT_ANSWERED),
        q5: answer(ANSWER_STATE.NOT_VISITED),
      },
    });

    assert.equal(answeredCountOf(state), 2);
  });

  /** The bug this prevents: an admin reading "0 answered" for a sitting that is going fine. */
  it('says the live state is gone rather than reporting nothing answered', () => {
    const [row] = sittingsFrom([sitting()], NO_LIVE_STATE, QUESTION_COUNT);

    assert.equal(row?.answeredCount, null);
    assert.equal(row?.hasLiveState, false);
    assert.equal(row?.endsAt, ENDS_AT.toISOString());
  });

  /** Redis owns the running clock, so an extension shows before the row is read again. */
  it('takes the deadline from the live state when it has one', () => {
    const extended = new Date('2026-09-09T11:00:00.000Z');
    const live = new Map([
      [
        'att_1',
        held({ endsAt: extended.toISOString(), answers: { q1: answer(ANSWER_STATE.ANSWERED) } }),
      ],
    ]);

    const [row] = sittingsFrom([sitting()], live, QUESTION_COUNT);

    assert.equal(row?.endsAt, extended.toISOString());
    assert.equal(row?.answeredCount, 1);
    assert.equal(row?.questionCount, QUESTION_COUNT);
  });
});

describe('which tests the ops picker offers', () => {
  /** A practice sitting has no hall, no invigilation and no ranked slot to protect (§7). */
  it('offers ranked tests only, never practice ones', () => {
    const where = watchableTestsWhere(undefined);

    assert.equal(where.evaluationMode, EVALUATION_MODE.RANKED);
  });

  it('offers active tests only, whether or not a search narrows them', () => {
    assert.equal(watchableTestsWhere(undefined).status, TEST_STATUS.ACTIVE);
    assert.equal(watchableTestsWhere('cgl').status, TEST_STATUS.ACTIVE);
  });

  it('keeps the ranked rule when a search is typed, rather than replacing the filter', () => {
    const where = watchableTestsWhere('cgl');

    assert.equal(where.evaluationMode, EVALUATION_MODE.RANKED);
    assert.equal(where.OR?.length, 2);
  });

  it('asks nothing about titles when nothing was typed', () => {
    assert.equal(watchableTestsWhere(undefined).OR, undefined);
  });
});
