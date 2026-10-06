import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AppException, ErrorCodes } from '@iace/contracts';
import { MARKING_TRIES, isMarkingPending, retryWhileMarking } from '../src/marking';

describe('reading a score card the marking job has not reached', () => {
  /** Nothing polls on the student's behalf now, so arriving early is ordinary, not a failure. */
  it('reads a CONFLICT as marking still being queued', () => {
    assert.equal(isMarkingPending(new AppException(ErrorCodes.CONFLICT)), true);
  });

  /** The bug this prevents: "your score card did not load" on a paper that is merely unmarked. */
  it('reads any other failure as a real one', () => {
    assert.equal(isMarkingPending(new AppException(ErrorCodes.NOT_FOUND)), false);
    assert.equal(isMarkingPending(new AppException(ErrorCodes.INTERNAL)), false);
    assert.equal(isMarkingPending(new Error('network down')), false);
    assert.equal(isMarkingPending({ code: ErrorCodes.CONFLICT }), false, 'a look-alike is not one');
  });
});

describe('asking again for a paper the marking job has not reached', () => {
  const pending = new AppException(ErrorCodes.CONFLICT);

  it('asks again by itself, a bounded number of times', () => {
    for (let failures = 0; failures < MARKING_TRIES; failures += 1) {
      assert.equal(retryWhileMarking(failures, pending), true, `after ${failures} failures`);
    }
    assert.equal(retryWhileMarking(MARKING_TRIES, pending), false);
  });

  /** The failure this prevents: the poll that ran until the drain ended, and lengthened the drain. */
  it('keeps every other failure on the one retry all reads get', () => {
    assert.equal(retryWhileMarking(0, new Error('network down')), true);
    assert.equal(retryWhileMarking(1, new Error('network down')), false);
    assert.equal(retryWhileMarking(0, new AppException(ErrorCodes.NOT_FOUND)), false);
  });
});
