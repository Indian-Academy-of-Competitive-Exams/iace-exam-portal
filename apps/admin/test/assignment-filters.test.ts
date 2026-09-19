import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { chooseTest } from '../src/lib/assignment-filters';

const BANKING = 'tst_banking';
const RAILWAY = 'tst_railway';
const REASONING = 'sec_reasoning';

describe('the test and section filters cascade', () => {
  /** The failure this prevents: Railway + Banking's Reasoning section matches nothing at all. */
  it('drops the section when another test is chosen', () => {
    assert.deepEqual(chooseTest(RAILWAY, BANKING, REASONING), {
      testId: RAILWAY,
      baseConfigSectionId: '',
    });
  });

  it('keeps the section while the test it belongs to is the one chosen', () => {
    assert.deepEqual(chooseTest(BANKING, BANKING, REASONING), {
      testId: BANKING,
      baseConfigSectionId: REASONING,
    });
  });

  it('drops the section when the test is cleared', () => {
    assert.deepEqual(chooseTest('', BANKING, REASONING), {
      testId: '',
      baseConfigSectionId: '',
    });
  });
});
