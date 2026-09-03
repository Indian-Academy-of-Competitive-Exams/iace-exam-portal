import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PIN_LENGTH, pinSchema } from '@iace/contracts';
import { randomPin } from '../src/auth/pin/random-pin';

/** The PIN a roster import issues, which the student is told once and nobody can derive. */
describe('randomPin', () => {
  /** The failure this prevents: a PIN the login schema refuses is an import that signs nobody in. */
  it('always produces something the login screen will accept', () => {
    for (let i = 0; i < 500; i += 1) {
      const pin = randomPin();

      assert.equal(pin.length, PIN_LENGTH);
      assert.equal(pinSchema.safeParse(pin).success, true, pin);
    }
  });

  /** The whole point: a roster in the wrong hands must not be a list of PINs. */
  it('does not repeat itself, so a roster tells nobody anything', () => {
    const pins = new Set(Array.from({ length: 400 }, () => randomPin()));

    assert.ok(pins.size > 300, `only ${pins.size} distinct PINs in 400 — that is not random`);
  });

  /** Naively taking a byte modulo 10 makes 0-5 come up 26/256 and 6-9 only 25/256. */
  it('reaches every digit in every position, without leaning on the low ones', () => {
    const seen = Array.from({ length: PIN_LENGTH }, () => new Set<string>());
    for (let i = 0; i < 2000; i += 1) {
      randomPin()
        .split('')
        .forEach((digit, at) => seen[at]?.add(digit));
    }

    for (const position of seen) assert.equal(position.size, 10);
  });
});
