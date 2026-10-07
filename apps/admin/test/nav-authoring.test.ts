import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { FEATURE_KEYS, type FeatureKey } from '@iace/contracts';
import { filterNavByPermission } from '@iace/app-kit';
import { NAV_ITEMS, ROUTES, filterAdminNav } from '../src/lib/constants';

const holding = (...keys: FeatureKey[]) => {
  const held = new Set<FeatureKey>(keys);
  return (key: FeatureKey) => held.has(key);
};

const sections = (keys: FeatureKey[]) =>
  filterNavByPermission(NAV_ITEMS, holding(...keys)).map((item) => item.label);

describe('the Authoring section', () => {
  it('gives a typist Authoring with its three rows, and a reader Proof-reading with their queue', () => {
    const rowsOf = (key: FeatureKey, label: string) =>
      filterNavByPermission(NAV_ITEMS, holding(key))
        .find((item) => item.label === label)
        ?.children?.map((child) => child.to);

    assert.deepEqual(rowsOf(FEATURE_KEYS.QUESTION_AUTHORING, 'Authoring'), [
      ROUTES.AUTHORING_EDITOR,
      ROUTES.AUTHORING_ASSIGNMENTS,
      ROUTES.AUTHORING_HISTORY,
    ]);
    assert.deepEqual(rowsOf(FEATURE_KEYS.QUESTION_PROOFREAD, 'Proof-reading'), [
      ROUTES.PROOFREADING_ASSIGNMENTS,
    ]);
  });

  it('is gone for an admin who does not, however much else they hold', () => {
    assert.ok(!sections([FEATURE_KEYS.QUESTION_MANAGEMENT]).includes('Authoring'));
    assert.ok(!sections([]).includes('Authoring'));
  });

  /** The failure this prevents: authoring folded into the bank, so a typist gets the whole bank. */
  it('is the only section a typist reaches, beside the audit log every admin has', () => {
    const can = holding(FEATURE_KEYS.QUESTION_AUTHORING);
    const forTypist = filterAdminNav(NAV_ITEMS, { isSuperAdmin: false, can });
    const shown = filterNavByPermission(forTypist, can);

    assert.deepEqual(
      shown.map((item) => item.label),
      ['Authoring', 'Audit log'],
    );
  });
});
