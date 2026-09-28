import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { minutesFieldOf, secondsFromMinutes } from '../src/lib/duration';

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
