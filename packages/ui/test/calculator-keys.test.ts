import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  CALCULATOR_ERROR,
  CALCULATOR_KEYS,
  CALCULATOR_OPS,
  CALCULATOR_START,
  pressCalculatorKey,
} from '../src/components/ui/calculator-keys';

const press = (...keys: readonly string[]): string =>
  keys.reduce(pressCalculatorKey, CALCULATOR_START).display;

/** A candidate checks their arithmetic against this, so being right is the whole feature. */
describe('pressCalculatorKey', () => {
  it('works the four functions', () => {
    assert.equal(press('2', CALCULATOR_OPS.ADD, '3', CALCULATOR_KEYS.EQUALS), '5');
    assert.equal(press('9', CALCULATOR_OPS.SUBTRACT, '4', CALCULATOR_KEYS.EQUALS), '5');
    assert.equal(press('6', CALCULATOR_OPS.MULTIPLY, '7', CALCULATOR_KEYS.EQUALS), '42');
    assert.equal(press('8', CALCULATOR_OPS.DIVIDE, '2', CALCULATOR_KEYS.EQUALS), '4');
  });

  it('folds a chain as each operator is pressed, the way a pocket calculator does', () => {
    const chain = ['2', CALCULATOR_OPS.ADD, '3', CALCULATOR_OPS.ADD];
    assert.equal(press(...chain), '5');
    assert.equal(press(...chain, '4', CALCULATOR_KEYS.EQUALS), '9');
  });

  it('shows 0.3, not the float that 0.1 plus 0.2 really is', () => {
    const decimal = CALCULATOR_KEYS.DECIMAL;
    assert.equal(
      press('0', decimal, '1', CALCULATOR_OPS.ADD, '0', decimal, '2', CALCULATOR_KEYS.EQUALS),
      '0.3',
    );
  });

  it('replaces the pending operator rather than folding a result into itself', () => {
    const wrong = ['5', CALCULATOR_OPS.ADD, CALCULATOR_OPS.MULTIPLY, '3', CALCULATOR_KEYS.EQUALS];
    assert.equal(press(...wrong), '15');
  });

  it('locks on a divide by zero until Clear, so no later key reads as an answer', () => {
    const broken = ['1', CALCULATOR_OPS.DIVIDE, '0', CALCULATOR_KEYS.EQUALS];
    assert.equal(press(...broken), CALCULATOR_ERROR);
    assert.equal(press(...broken, '5', CALCULATOR_OPS.ADD, '5'), CALCULATOR_ERROR);
    assert.equal(press(...broken, CALCULATOR_KEYS.CLEAR, '7'), '7');
  });

  it('takes one decimal point only, and starts one from nothing as 0.', () => {
    const decimal = CALCULATOR_KEYS.DECIMAL;
    assert.equal(press('1', decimal, '5', decimal, '2'), '1.52');
    assert.equal(press(decimal, '5'), '0.5');
  });

  it('backs out of what is being typed and never out of a result', () => {
    const back = CALCULATOR_KEYS.BACKSPACE;
    assert.equal(press('1', '2', '3', back), '12');
    assert.equal(press('7', back), '0');
    assert.equal(press('2', CALCULATOR_OPS.ADD, '3', CALCULATOR_KEYS.EQUALS, back), '5');
  });

  it('caps an entry rather than taking digits a 12-figure display cannot show', () => {
    assert.equal(press(...'1234567890123456'.split('')), '123456789012');
  });
});
