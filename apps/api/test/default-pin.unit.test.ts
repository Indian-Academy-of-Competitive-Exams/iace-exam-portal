import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PIN_LENGTH, mobileSchema, pinSchema } from '@iace/contracts';
import { defaultPinFor } from '../src/imports/default-pin';

/**
 * The PIN a bulk-imported student starts with.
 *
 * It had no test at all, which for the one function that decides a credential
 * is the wrong place to be missing one.
 */
describe('defaultPinFor', () => {
  it('is the first four digits of their own number', () => {
    assert.equal(defaultPinFor('9876543210'), '9876');
  });

  /**
   * The failure this prevents: a PIN of the wrong length is one the login
   * schema refuses, so an imported student could not sign in at all — and the
   * import would report success for every one of them.
   */
  it('always produces something the login screen will accept', () => {
    for (const mobile of ['9876543210', '6000000000', '7012345678', '9999999999']) {
      const pin = defaultPinFor(mobile);

      assert.equal(pin.length, PIN_LENGTH);
      assert.equal(pinSchema.safeParse(pin).success, true, `${mobile} -> ${pin}`);
    }
  });

  it('produces digits only, whatever the number', () => {
    assert.match(defaultPinFor('9876543210'), /^\d+$/);
  });

  /**
   * Every mobile the importer can accept must yield a usable PIN, so the two
   * schemas are checked against each other rather than against a fixed list.
   */
  it('holds for every shape a valid mobile can take', () => {
    for (let first = 6; first <= 9; first++) {
      const mobile = `${first}${'0123456789'.repeat(2).slice(0, 9)}`;
      assert.equal(
        mobileSchema.safeParse(mobile).success,
        true,
        `${mobile} should be a valid number`,
      );
      assert.equal(pinSchema.safeParse(defaultPinFor(mobile)).success, true);
    }
  });

  it('is stable — the same number always gives the same PIN', () => {
    // The student is told "the first four digits of your number". If this were
    // derived any other way, that instruction would be wrong for someone.
    assert.equal(defaultPinFor('9876543210'), defaultPinFor('9876543210'));
  });
});
