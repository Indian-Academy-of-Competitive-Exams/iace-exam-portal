import test from 'node:test';
import assert from 'node:assert/strict';
import { cardPlacement, clampedBox, isRingable } from '../src/lib/tour-placement';

const SCREEN = { width: 390, height: 800 };

test('the card sits under a target with room below it', () => {
  assert.deepEqual(cardPlacement({ x: 20, y: 100, width: 240, height: 40 }, SCREEN), { top: 152 });
});

test('the card sits over a target too near the bottom to fit under', () => {
  assert.deepEqual(cardPlacement({ x: 20, y: 700, width: 240, height: 40 }, SCREEN), {
    bottom: 112,
  });
});

/** A short screen with the target across its middle: neither side has the room, so neither is chosen. */
test('the card is centred when neither side has room', () => {
  const placement = cardPlacement(
    { x: 0, y: 100, width: 390, height: 200 },
    { ...SCREEN, height: 320 },
  );

  assert.deepEqual(placement, { top: 80 });
});

test('a target at the very top puts the card under it rather than off the screen', () => {
  assert.deepEqual(cardPlacement({ x: 20, y: 0, width: 240, height: 40 }, SCREEN), { top: 52 });
});

/** The defect this pins: a target below the fold gave a dim pane taller than the window and a card off the bottom. */
test('a target past the bottom of the window is cut to nothing', () => {
  assert.deepEqual(clampedBox({ x: 20, y: 900, width: 240, height: 40 }, SCREEN), {
    x: 20,
    y: 800,
    width: 240,
    height: 0,
  });
});

test('a target running off the bottom keeps only the part on screen', () => {
  assert.deepEqual(clampedBox({ x: 20, y: 760, width: 240, height: 100 }, SCREEN), {
    x: 20,
    y: 760,
    width: 240,
    height: 40,
  });
});

test('a target scrolled above the top keeps only the part on screen', () => {
  assert.deepEqual(clampedBox({ x: 20, y: -30, width: 240, height: 100 }, SCREEN), {
    x: 20,
    y: 0,
    width: 240,
    height: 70,
  });
});

test('a target wider than the window is cut to it', () => {
  assert.deepEqual(clampedBox({ x: 300, y: 100, width: 200, height: 40 }, SCREEN), {
    x: 300,
    y: 100,
    width: 90,
    height: 40,
  });
});

test('a target on screen is ringable', () => {
  assert.equal(isRingable({ x: 20, y: 100, width: 240, height: 40 }, SCREEN), true);
});

test('a target with no size is not ringable', () => {
  assert.equal(isRingable({ x: 20, y: 100, width: 240, height: 0 }, SCREEN), false);
  assert.equal(isRingable({ x: 20, y: 100, width: 0, height: 40 }, SCREEN), false);
});

test('a target below the fold or scrolled past is not ringable', () => {
  assert.equal(isRingable({ x: 20, y: 900, width: 240, height: 40 }, SCREEN), false);
  assert.equal(isRingable({ x: 20, y: -80, width: 240, height: 40 }, SCREEN), false);
});

test('a target half on screen is still ringable', () => {
  assert.equal(isRingable({ x: 20, y: 780, width: 240, height: 60 }, SCREEN), true);
});
