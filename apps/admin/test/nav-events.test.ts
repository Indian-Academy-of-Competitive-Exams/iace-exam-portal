import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { FEATURE_KEYS, type FeatureKey } from '@iace/contracts';
import { filterNavByPermission } from '@iace/app-kit';
import { NAV_ITEMS, ROUTES } from '../src/lib/constants';

const holding = (...keys: FeatureKey[]) => {
  const held = new Set<FeatureKey>(keys);
  return (key: FeatureKey) => held.has(key);
};

const testRows = (...keys: FeatureKey[]) =>
  filterNavByPermission(NAV_ITEMS, holding(...keys))
    .find((item) => item.label === 'Tests')
    ?.children?.map((child) => child.to);

describe('the Events row', () => {
  it('sits under Tests, beside the test series it feeds', () => {
    const rows = testRows(FEATURE_KEYS.TEST_MANAGEMENT, FEATURE_KEYS.EVENT);

    assert.ok(rows);
    assert.equal(rows.indexOf(ROUTES.EVENTS), rows.indexOf(ROUTES.TEST_SERIES) + 1);
  });

  /** The failure this prevents: an events roster offered to every admin who manages tests. */
  it('is gone for an admin who manages tests without holding the event key', () => {
    const rows = testRows(FEATURE_KEYS.TEST_MANAGEMENT);

    assert.ok(rows);
    assert.ok(rows.includes(ROUTES.TEST_SERIES));
    assert.ok(!rows.includes(ROUTES.EVENTS));
  });
});
