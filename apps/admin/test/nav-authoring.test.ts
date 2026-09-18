import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { FEATURE_KEYS, type FeatureKey } from '@iace/contracts';
import { activeNavPath, filterNavByPermission } from '@iace/app-kit';
import { NAV_ITEMS, ROUTES, filterAdminNav } from '../src/lib/constants';

const holding = (...keys: FeatureKey[]) => {
  const held = new Set<FeatureKey>(keys);
  return (key: FeatureKey) => held.has(key);
};

const sections = (keys: FeatureKey[]) =>
  filterNavByPermission(NAV_ITEMS, holding(...keys)).map((item) => item.label);

describe('the Authoring section', () => {
  it('is there for an admin who holds the key, with all three of its rows', () => {
    const shown = filterNavByPermission(NAV_ITEMS, holding(FEATURE_KEYS.QUESTION_AUTHORING));
    const authoring = shown.find((item) => item.label === 'Authoring');

    assert.ok(authoring);
    assert.deepEqual(
      authoring.children?.map((child) => child.to),
      [ROUTES.AUTHORING_EDITOR, ROUTES.AUTHORING_ASSIGNMENTS, ROUTES.AUTHORING_HISTORY],
    );
  });

  it('is gone for an admin who does not, however much else they hold', () => {
    assert.ok(!sections([FEATURE_KEYS.QUESTION_MANAGEMENT]).includes('Authoring'));
    assert.ok(!sections([]).includes('Authoring'));
  });

  /** The failure this prevents: a screen opened from a queue lighting up a row it did not come from. */
  it('keeps a scoped screen under the queue it was opened from', () => {
    assert.equal(
      activeNavPath(NAV_ITEMS, ROUTES.AUTHORING_FOR_ASSIGNMENT('an-assignment')),
      ROUTES.AUTHORING_ASSIGNMENTS,
    );
    assert.equal(
      activeNavPath(NAV_ITEMS, ROUTES.PROOFREADING_SECTION('an-assignment')),
      ROUTES.PROOFREADING_ASSIGNMENTS,
    );
  });

  /** The failure this prevents: authoring folded into the bank, so a typist gets the whole bank. */
  it('is the only section a typist reaches, beside the audit log every admin has', () => {
    const forTypist = filterAdminNav(NAV_ITEMS, { isSuperAdmin: false });
    const shown = filterNavByPermission(forTypist, holding(FEATURE_KEYS.QUESTION_AUTHORING));

    assert.deepEqual(
      shown.map((item) => item.label),
      ['Authoring', 'Audit log'],
    );
  });
});
