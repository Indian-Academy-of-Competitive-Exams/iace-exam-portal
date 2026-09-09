import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ITEM_SIGNALS,
  ITEM_SIGNAL_FLOOR,
  itemSignalsOf,
  medianInBands,
  worthInspecting,
  type ItemCounts,
} from '../src/stats';

const SAT = ITEM_SIGNAL_FLOOR * 4;

function item(overrides: Partial<ItemCounts> = {}): ItemCounts {
  return {
    attemptedCount: SAT,
    skippedCount: 0,
    pValue: 0.8,
    discrimination: null,
    averageTimeSec: 40,
    ...overrides,
  };
}

describe('medianInBands', () => {
  it('lands inside the band holding the middle sitting', () => {
    const bands = [
      { from: 0, to: 10, count: 10 },
      { from: 10, to: 20, count: 20 },
      { from: 20, to: 30, count: 10 },
    ];
    assert.equal(medianInBands(bands), 15);
  });

  it('does not answer at all where nothing was counted', () => {
    assert.equal(medianInBands([]), null);
    assert.equal(medianInBands([{ from: 0, to: 10, count: 0 }]), null);
  });

  it('reads a negative floor, because negative marking puts scores below zero', () => {
    const bands = [
      { from: -10, to: 0, count: 4 },
      { from: 0, to: 10, count: 4 },
    ];
    assert.equal(medianInBands(bands), 0);
  });
});

describe('itemSignalsOf', () => {
  it('says nothing about an item too few sittings have touched', () => {
    const thin = item({ attemptedCount: 1, skippedCount: 1, pValue: 0 });
    assert.deepEqual(itemSignalsOf(thin, 30), []);
  });

  it('flags a question answered right below chance', () => {
    assert.deepEqual(itemSignalsOf(item({ pValue: 0.2 }), 30), [ITEM_SIGNALS.LOW_ACCURACY]);
  });

  it('flags a question most of the field left blank', () => {
    const skipped = item({ attemptedCount: 10, skippedCount: 30 });
    assert.deepEqual(itemSignalsOf(skipped, 30), [ITEM_SIGNALS.HIGH_SKIP]);
  });

  it('reads slow against the paper it sits on, not a fixed clock', () => {
    const slow = item({ averageTimeSec: 90 });
    assert.deepEqual(itemSignalsOf(slow, 30), [ITEM_SIGNALS.SLOW]);
    assert.deepEqual(itemSignalsOf(slow, 120), []);
  });

  it('flags a negative discrimination where the fold has written one', () => {
    const inverted = item({ discrimination: -0.2 });
    assert.deepEqual(itemSignalsOf(inverted, 30), [ITEM_SIGNALS.NEGATIVE_DISCRIMINATION]);
  });

  it('says nothing where the paper has no average to read time against', () => {
    assert.deepEqual(itemSignalsOf(item({ averageTimeSec: 9000 }), null), []);
  });
});

describe('worthInspecting', () => {
  it('holds its fire on a single signal, which is a property of the question', () => {
    assert.equal(worthInspecting({ signals: [ITEM_SIGNALS.LOW_ACCURACY] }), false);
  });

  it('flags an item once two signals land at once', () => {
    const both = itemSignalsOf(item({ pValue: 0.1, attemptedCount: 10, skippedCount: 30 }), 30);
    assert.deepEqual(both, [ITEM_SIGNALS.LOW_ACCURACY, ITEM_SIGNALS.HIGH_SKIP]);
    assert.equal(worthInspecting({ signals: both }), true);
  });
});
