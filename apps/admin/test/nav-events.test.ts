import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { FEATURE_KEYS, type FeatureKey } from '@iace/contracts';
import { filterNavByPermission } from '@iace/app-kit';
import { NAV_ITEMS, ROUTES } from '../src/lib/constants';

const holding = (...keys: FeatureKey[]) => {
  const held = new Set<FeatureKey>(keys);
  return (key: FeatureKey) => held.has(key);
};

const sections = (...keys: FeatureKey[]) =>
  filterNavByPermission(NAV_ITEMS, holding(...keys)).map((item) => item.label);

describe('the Events section', () => {
  // Under Tests, the section's own key is read first and an EVENT-only admin reaches nothing.
  it('stands on its own, so an admin holding only the event key still reaches it', () => {
    const shown = filterNavByPermission(NAV_ITEMS, holding(FEATURE_KEYS.EVENT));
    const events = shown.find((item) => item.label === 'Events');

    assert.ok(events);
    assert.deepEqual(
      events.children?.map((child) => child.to),
      [ROUTES.EVENTS],
    );
  });

  it('is gone for an admin who manages tests without holding the event key', () => {
    const shown = sections(FEATURE_KEYS.TEST_MANAGEMENT);

    assert.ok(shown.includes('Tests'));
    assert.ok(!shown.includes('Events'));
  });
});
