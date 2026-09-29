import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { durationLabel, minutesFieldOf, secondsFromMinutes } from '../src/lib/duration';

describe('the minutes a duration is edited in', () => {
  /** The failure this prevents: opening and saving a configuration quietly moving 22.5 minutes to 23. */
  it('brings every whole number of seconds back unchanged', () => {
    for (const seconds of [1, 7, 60, 1000, 1350, 3599, 5400, 10_799]) {
      assert.equal(secondsFromMinutes(minutesFieldOf(seconds)), seconds);
    }
  });

  it('writes a whole minute without a decimal point', () => {
    assert.equal(minutesFieldOf(5400), '90');
    assert.equal(minutesFieldOf(1350), '22.5');
  });
});

describe('a duration shown in a list', () => {
  /** The failure this prevents: a list saying 23 min for the 22.5 its form holds. */
  it('keeps the half minute the form keeps, and rounds a stray second away', () => {
    assert.equal(durationLabel(1350), '22.5 min');
    assert.equal(durationLabel(5400), '90 min');
    assert.equal(durationLabel(3599), '60 min');
  });
});
