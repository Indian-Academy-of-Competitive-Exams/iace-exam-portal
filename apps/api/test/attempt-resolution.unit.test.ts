import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ATTEMPT_STATUS } from '@iace/contracts';
import {
  SUPPORT_ACTIONS,
  resolutionBlocker,
  supportDiff,
} from '../src/attempts/attempt-resolution';
import { slotsAfter } from '../src/attempts/attempt-rules';

const LIVE_ONLY = [
  SUPPORT_ACTIONS.FORCE_SUBMIT,
  SUPPORT_ACTIONS.EXTEND,
  SUPPORT_ACTIONS.RESET,
] as const;

describe('support actions — what may be done to a sitting', () => {
  it('lets the three live actions through only while the sitting is in progress', () => {
    for (const action of LIVE_ONLY) {
      assert.equal(resolutionBlocker(action, ATTEMPT_STATUS.IN_PROGRESS), null);
    }
  });

  /** The bug this prevents: a reset putting a marked sitting back and un-scoring a real result. */
  it('refuses the three live actions on a sitting that has already ended', () => {
    for (const action of LIVE_ONLY) {
      for (const status of [ATTEMPT_STATUS.SUBMITTED, ATTEMPT_STATUS.EVALUATED] as const) {
        assert.notEqual(resolutionBlocker(action, status), null);
      }
    }
  });

  /** The bug this prevents: a reset on a void sitting being told to void it. */
  it('tells every action on a void sitting that it is already void', () => {
    const alreadyVoid = resolutionBlocker(SUPPORT_ACTIONS.VOID, ATTEMPT_STATUS.VOIDED);

    for (const action of LIVE_ONLY) {
      assert.equal(resolutionBlocker(action, ATTEMPT_STATUS.VOIDED), alreadyVoid);
      assert.notEqual(resolutionBlocker(action, ATTEMPT_STATUS.SUBMITTED), alreadyVoid);
      assert.notEqual(resolutionBlocker(action, ATTEMPT_STATUS.EVALUATED), alreadyVoid);
    }
  });

  it('voids a sitting in any state but one already void', () => {
    for (const status of [
      ATTEMPT_STATUS.IN_PROGRESS,
      ATTEMPT_STATUS.SUBMITTED,
      ATTEMPT_STATUS.EVALUATED,
      ATTEMPT_STATUS.EXPIRED,
    ] as const) {
      assert.equal(resolutionBlocker(SUPPORT_ACTIONS.VOID, status), null);
    }
    assert.notEqual(resolutionBlocker(SUPPORT_ACTIONS.VOID, ATTEMPT_STATUS.VOIDED), null);
  });

  it('files the action, the sitting and the reason beside whatever moved', () => {
    const diff = supportDiff(SUPPORT_ACTIONS.VOID, 'Power cut at the branch', 'att_1', {
      status: { from: ATTEMPT_STATUS.EVALUATED, to: ATTEMPT_STATUS.VOIDED },
    });

    assert.deepEqual(diff.supportAction, { from: null, to: SUPPORT_ACTIONS.VOID });
    assert.deepEqual(diff.attemptId, { from: null, to: 'att_1' });
    assert.deepEqual(diff.reason, { from: null, to: 'Power cut at the branch' });
    assert.deepEqual(diff.status, {
      from: ATTEMPT_STATUS.EVALUATED,
      to: ATTEMPT_STATUS.VOIDED,
    });
  });
});

describe('the ranked slot — spent unless a void hands it back', () => {
  it('ranks the first sitting and numbers it one', () => {
    const slots = slotsAfter([]);

    assert.deepEqual(slots, { attemptNo: 1, ranksAgain: true });
  });

  /** The bug this prevents: a retake quietly ranking a second time and folding into the cohort twice. */
  it('leaves a retake unranked while a real sitting still holds the slot', () => {
    const slots = slotsAfter([{ status: ATTEMPT_STATUS.EVALUATED, isGraded: true }]);

    assert.equal(slots.ranksAgain, false);
    assert.equal(slots.attemptNo, 2);
  });

  /** A void without the regrant: they may sit again, but that sitting is a retake. */
  it('keeps the slot spent when a voided sitting still carries it', () => {
    const slots = slotsAfter([{ status: ATTEMPT_STATUS.VOIDED, isGraded: true }]);

    assert.equal(slots.ranksAgain, false);
    // A sitting that was stood down still took its number: the attempt number is a key, not a tally.
    assert.equal(slots.attemptNo, 2);
  });

  /** A void WITH the regrant cleared `isGraded`, which is what hands the slot to the next sitting. */
  it('ranks the next sitting once the voided one has given the slot up', () => {
    const slots = slotsAfter([{ status: ATTEMPT_STATUS.VOIDED, isGraded: false }]);

    assert.equal(slots.ranksAgain, true);
    assert.equal(slots.attemptNo, 2);
  });
});
