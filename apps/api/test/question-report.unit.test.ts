import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { COHORT_COMPARISON_FLOOR } from '@iace/contracts';
import { paceIndexOf } from '../src/attempts/question-report';

describe('paceIndexOf', () => {
  it('reads above one for slower than the field and below it for faster', () => {
    assert.equal(paceIndexOf(240, 1200, 10), 2);
    assert.equal(paceIndexOf(60, 1200, 10), 0.5);
  });

  it('has no answer where the cohort has no clock, rather than dividing by nothing', () => {
    assert.equal(paceIndexOf(240, 1200, 0), null);
    assert.equal(paceIndexOf(240, 0, 10), null);
    assert.equal(paceIndexOf(240, Number.NaN, 10), null);
  });

  /** The failure this prevents: the score card quoting a pace the Questions tab refuses to draw. */
  it('has no answer under the comparison floor, however much clock the few who sat it kept', () => {
    const under = COHORT_COMPARISON_FLOOR - 1;

    assert.equal(paceIndexOf(240, under * 120, under), null);
    assert.equal(paceIndexOf(240, COHORT_COMPARISON_FLOOR * 120, COHORT_COMPARISON_FLOOR), 2);
  });
});
