import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { digitsOnly } from '../src/components/ui/numeric-input';

/**
 * The filtering rule behind NumericInput. `type="tel"` and `inputMode` only ask
 * politely — a physical keyboard ignores both — so this is what actually keeps
 * a letter out of a mobile-number field.
 */
describe('digitsOnly', () => {
  it('drops everything that is not a digit', () => {
    assert.equal(digitsOnly('abcdef'), '');
    assert.equal(digitsOnly('a9b8c7'), '987');
    assert.equal(digitsOnly('98!@#76%^54'), '987654');
    assert.equal(digitsOnly('  98765 43210 '), '9876543210');
  });

  it('caps the length when asked, and leaves it alone when not', () => {
    assert.equal(digitsOnly('98765432109999', 10), '9876543210');
    assert.equal(digitsOnly('481399', 4), '4813');
    assert.equal(digitsOnly('98765432109999'), '98765432109999');
  });

  it('handles the empty and all-junk cases without throwing', () => {
    assert.equal(digitsOnly(''), '');
    assert.equal(digitsOnly('+-() '), '');
    assert.equal(digitsOnly('', 4), '');
  });
});
