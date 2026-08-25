import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isNotNumeric, numberOr, optionalNumber } from '../src/form-numbers';

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

describe('isNotNumeric', () => {
  it('names the field a form has to refuse', () => {
    assert.equal(isNotNumeric('two'), true);
    assert.equal(isNotNumeric('Infinity'), true);
  });

  it('leaves a blank field alone, because blank is an answer', () => {
    // The failure this prevents: refusing the blank that means "unlimited".
    assert.equal(isNotNumeric(''), false);
    assert.equal(isNotNumeric('  '), false);
  });

  it('leaves a number alone', () => {
    assert.equal(isNotNumeric('12'), false);
    assert.equal(isNotNumeric(' 0.5 '), false);
  });
});
