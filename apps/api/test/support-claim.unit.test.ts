import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { sameName } from '../src/support/claim';

describe('sameName', () => {
  it('ignores case, dots and extra spaces', () => {
    assert.equal(sameName('A. Asha  Rao', 'a asha rao'), true);
  });
  it('does not match a different name', () => {
    assert.equal(sameName('Asha Rao', 'Asha Reddy'), false);
  });
  it('does not match a missing name', () => {
    assert.equal(sameName(null, 'Asha Rao'), false);
  });
});
