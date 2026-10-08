import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ITEM_SIGNALS,
  ITEM_SIGNAL_FLOOR,
  itemSignalsOf,
  worthInspecting,
  type ItemCounts,
} from '../src/stats';

const SAT = ITEM_SIGNAL_FLOOR * 4;

function item(overrides: Partial<ItemCounts> = {}): ItemCounts {
  return {
    attemptedCount: SAT,
    skippedCount: 0,
    pValue: 0.8,
    averageTimeSec: 40,
    ...overrides,
  };
}

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
