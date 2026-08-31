import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ANSWER_STATE, ANSWER_STATES, OMR_FILL, omrFillFor, omrStateFor } from '../src/index';

/** A bubble's fill IS its answer state. Nothing stores the fill, so these two must stay inverses. */

describe('omrStateFor — what a fill commits to', () => {
  it('reads an empty bubble as unanswered', () => {
    assert.equal(omrStateFor(0), ANSWER_STATE.NOT_ANSWERED);
  });

  /** The failure this prevents: a stray tap silently flagging a question nobody engaged with. */
  it('treats anything below the minimum as a smudge, not an answer', () => {
    assert.equal(omrStateFor(OMR_FILL.MIN - 0.01), ANSWER_STATE.NOT_ANSWERED);
    assert.equal(omrStateFor(OMR_FILL.MIN), ANSWER_STATE.ANSWERED_MARKED);
  });

  it('reads a partly filled bubble as answered and flagged', () => {
    assert.equal(omrStateFor(OMR_FILL.PARTIAL), ANSWER_STATE.ANSWERED_MARKED);
  });

  /** The failure this prevents: locking an answer the student had not finished making. */
  it('does not commit one step short of full', () => {
    assert.equal(omrStateFor(OMR_FILL.FULL - 0.01), ANSWER_STATE.ANSWERED_MARKED);
    assert.equal(omrStateFor(OMR_FILL.FULL), ANSWER_STATE.ANSWERED);
  });

  it('cannot be pushed past committed', () => {
    assert.equal(omrStateFor(OMR_FILL.FULL + 1), ANSWER_STATE.ANSWERED);
  });
});

describe('omrFillFor — redrawing a bubble on return or reload', () => {
  it('gives every answer state a fill, so no state can render undefined ink', () => {
    for (const state of ANSWER_STATES) {
      assert.equal(typeof omrFillFor(state), 'number', state);
    }
  });

  it('holds no ink for a state that holds no option', () => {
    assert.equal(omrFillFor(ANSWER_STATE.NOT_VISITED), 0);
    assert.equal(omrFillFor(ANSWER_STATE.NOT_ANSWERED), 0);
    // Marked with nothing chosen: the question is flagged, but no bubble was ever filled.
    assert.equal(omrFillFor(ANSWER_STATE.MARKED_REVIEW), 0);
  });

  /** Where the pair has to agree, or a reload redraws a bubble into a different state. */
  it('round-trips the two states a bubble can hold', () => {
    assert.equal(
      omrStateFor(omrFillFor(ANSWER_STATE.ANSWERED_MARKED)),
      ANSWER_STATE.ANSWERED_MARKED,
    );
    assert.equal(omrStateFor(omrFillFor(ANSWER_STATE.ANSWERED)), ANSWER_STATE.ANSWERED);
  });
});
