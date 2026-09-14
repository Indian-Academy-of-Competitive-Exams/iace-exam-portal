import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PIN_LENGTH, pinSchema } from '@iace/contracts';
import { fakeStartingPins } from './support/fakes';

const pinsFor = async (count: number) =>
  (await fakeStartingPins().mint(Array.from({ length: count }, (_, at) => `9${at}`))).map(
    (issued) => issued.pin,
  );

/** The PIN a roster import issues, which the student is told once and nobody can derive. */
describe('StartingPinService.mint', () => {
  /** The failure this prevents: a PIN the login schema refuses is an import that signs nobody in. */
  it('always produces something the login screen will accept', async () => {
    for (const pin of await pinsFor(500)) {
      assert.equal(pin.length, PIN_LENGTH);
      assert.equal(pinSchema.safeParse(pin).success, true, pin);
    }
  });

  /** The whole point: a roster in the wrong hands must not be a list of PINs. */
  it('does not repeat itself, so a roster tells nobody anything', async () => {
    const pins = new Set(await pinsFor(400));

    assert.ok(pins.size > 300, `only ${pins.size} distinct PINs in 400 — that is not random`);
  });

  it('reaches every digit in every position, leading zeros included', async () => {
    const seen = Array.from({ length: PIN_LENGTH }, () => new Set<string>());
    for (const pin of await pinsFor(2000)) {
      pin.split('').forEach((digit, at) => seen[at]?.add(digit));
    }

    for (const position of seen) assert.equal(position.size, 10);
  });
});
