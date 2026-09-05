import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { FEATURE_KEYS, type FeatureKey } from '@iace/contracts';
import { filterNavByPermission } from '@iace/app-kit';
import { NAV_ITEMS, ROUTES, filterAdminNav, type AdminNavItem } from '../src/lib/constants';

const holding = (...keys: FeatureKey[]) => {
  const held = new Set<FeatureKey>(keys);
  return (key: FeatureKey) => held.has(key);
};

const everyPath = (items: readonly AdminNavItem[]): string[] =>
  items.flatMap((item) => [...(item.to ? [item.to] : []), ...everyPath(item.children ?? [])]);

const childrenOf = (items: readonly AdminNavItem[], label: string) =>
  items.find((item) => item.label === label)?.children?.map((child) => child.to);

describe('the nav after programs and events merged', () => {
  it('gives programs and events one row under Students, not a section of their own', () => {
    const shown = filterNavByPermission(NAV_ITEMS, holding(FEATURE_KEYS.STUDENT_MANAGEMENT));

    assert.ok(!shown.some((item) => item.label === 'Events'));
    assert.deepEqual(childrenOf(shown as AdminNavItem[], 'Students'), [
      ROUTES.STUDENTS,
      ROUTES.BRANCHES,
      ROUTES.EXAMS,
      ROUTES.COHORTS,
    ]);
  });

  it('reaches events on the students key, the only key they have left', () => {
    const shown = filterNavByPermission(NAV_ITEMS, holding(FEATURE_KEYS.TEST_MANAGEMENT));

    assert.ok(!everyPath(shown as AdminNavItem[]).includes(ROUTES.COHORTS));
  });

  /** Importing is something you do to a list, so it is reached from that list, never from the nav. */
  it('offers no import destination of its own', () => {
    const paths = everyPath(NAV_ITEMS);

    assert.ok(!paths.includes(ROUTES.IMPORT_STUDENTS));
    assert.ok(!paths.includes(ROUTES.IMPORT_QUESTIONS));
  });

  it('keeps programs and events away from a branch admin, who runs one branch', () => {
    const shown = filterAdminNav(NAV_ITEMS, { isSuperAdmin: false, isBranchAdmin: true });
    const paths = everyPath(shown);

    assert.ok(paths.includes(ROUTES.STUDENTS));
    assert.ok(!paths.includes(ROUTES.COHORTS));
  });
});
