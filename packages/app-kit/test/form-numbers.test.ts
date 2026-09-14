import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { numberOr, optionalNumber } from '../src/form-numbers';

describe('optionalNumber', () => {
  it('reads a number, spaced or not', () => {
    assert.equal(optionalNumber('3'), 3);
    assert.equal(optionalNumber('  2.5  '), 2.5);
    assert.equal(optionalNumber('0'), 0);
  });

  it('reads a blank field as not set', () => {
    assert.equal(optionalNumber(''), null);
    assert.equal(optionalNumber('   '), null);
  });

  it('reads what is not a number as not set', () => {
    assert.equal(optionalNumber('two'), null);
    assert.equal(optionalNumber('3 tries'), null);
  });

  it('refuses a value no field can hold, however numeric it reads', () => {
    // The failure this prevents: `Infinity` surviving the parse and reaching JSON as null.
    assert.equal(optionalNumber('Infinity'), null);
    assert.equal(optionalNumber('-Infinity'), null);
  });
});

describe('numberOr', () => {
  it('takes the number when there is one', () => {
    assert.equal(numberOr('4', 0), 4);
  });

  it('falls back on a blank field and on one holding nonsense alike', () => {
    assert.equal(numberOr('', 0), 0);
    assert.equal(numberOr('lots', 0), 0);
  });
});
