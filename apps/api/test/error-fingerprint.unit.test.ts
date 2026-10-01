import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fingerprintOf } from '../src/common/all-exceptions.filter';

/** Two throws from the same place, built independently — what grouping has to recognise as one bug. */
function thrownFrom(message: string): Error {
  return new Error(message);
}

describe('fingerprintOf', () => {
  it('gives the same id to the same bug thrown twice', () => {
    assert.equal(fingerprintOf(thrownFrom('one')), fingerprintOf(thrownFrom('two')));
  });

  /** Sentry's core feature, reproduced: a different place in the code is a different issue. */
  it('gives a different id to a different call site', () => {
    const here = new Error('boom');
    const there = thrownFrom('boom');

    assert.notEqual(fingerprintOf(here), fingerprintOf(there));
  });

  it('separates error kinds thrown from the same line', () => {
    const makeBoth = () => [new TypeError('x'), new RangeError('x')] as const;
    const [typeError, rangeError] = makeBoth();

    assert.notEqual(fingerprintOf(typeError), fingerprintOf(rangeError));
  });

  /** A refactor that moves a function down the file must not read as a brand new bug. */
  it('ignores the line and column, so shifted code keeps its id', () => {
    const error = new Error('shifted');
    const original = fingerprintOf(error);

    error.stack = (error.stack ?? '').replace(
      /:(\d+):(\d+)/g,
      (_m, line: string, col: string) => `:${Number(line) + 40}:${Number(col) + 3}`,
    );

    assert.equal(fingerprintOf(error), original);
  });

  it('says so rather than inventing an id for a non-Error', () => {
    assert.equal(fingerprintOf('a string'), 'nostack');
    assert.equal(fingerprintOf(undefined), 'nostack');
  });

  it('is short enough to read in a log line', () => {
    assert.equal(fingerprintOf(new Error('x')).length, 10);
  });
});
