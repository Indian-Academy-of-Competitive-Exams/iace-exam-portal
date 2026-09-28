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
  it('is there for a typist with all three of its rows, and for a reader with only their sections', () => {
    const rowsFor = (key: FeatureKey) =>
      filterNavByPermission(NAV_ITEMS, holding(key))
        .find((item) => item.label === 'Authoring')
        ?.children?.map((child) => child.to);

    assert.deepEqual(rowsFor(FEATURE_KEYS.QUESTION_AUTHORING), [
      ROUTES.WORK,
      ROUTES.AUTHORING_EDITOR,
      ROUTES.AUTHORING_HISTORY,
    ]);
    assert.deepEqual(rowsFor(FEATURE_KEYS.QUESTION_PROOFREAD), [ROUTES.WORK]);
  });

  it('is gone for an admin who does not, however much else they hold', () => {
    assert.ok(!sections([FEATURE_KEYS.QUESTION_MANAGEMENT]).includes('Authoring'));
    assert.ok(!sections([]).includes('Authoring'));
  });

  /** The failure this prevents: a section opened from the queue lighting up a row it did not come from. */
  it('keeps a section and its questions under the queue they were opened from', () => {
    assert.equal(activeNavPath(NAV_ITEMS, ROUTES.SECTION('a-test', 'a-section')), ROUTES.WORK);
    assert.equal(
      activeNavPath(NAV_ITEMS, ROUTES.SECTION_QUESTION('a-test', 'a-section', 'a-question')),
      ROUTES.WORK,
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
