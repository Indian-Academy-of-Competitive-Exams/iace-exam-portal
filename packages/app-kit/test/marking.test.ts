import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AppException, ErrorCodes } from '@iace/contracts';
import { isMarkingPending } from '../src/marking';

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
