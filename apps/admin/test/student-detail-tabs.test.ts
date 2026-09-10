import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { FEATURE_KEYS, type FeatureKey } from '@iace/contracts';
import { openStudentTab, studentTabsFor, STUDENT_TABS } from '../src/routes/student-detail-tabs';

const holding = (...keys: FeatureKey[]) => {
  const held = new Set<FeatureKey>(keys);
  return (key: FeatureKey) => held.has(key);
};

const rights = (keys: FeatureKey[]) => ({ can: holding(...keys), isSuperAdmin: false });

describe('which tabs a student detail screen offers', () => {
  it('always offers the three every reader of a student can see', () => {
    const tabs = studentTabsFor(rights([FEATURE_KEYS.STUDENT_MANAGEMENT]));

    assert.deepEqual(tabs, [
      STUDENT_TABS.DETAILS,
      STUDENT_TABS.SERIES,
      STUDENT_TABS.EVENTS,
      STUDENT_TABS.ACTIONS,
    ]);
  });

  it('leaves Performance OUT without the feature, rather than drawing it dead', () => {
    const tabs = studentTabsFor(rights([FEATURE_KEYS.STUDENT_MANAGEMENT]));

    assert.ok(!tabs.includes(STUDENT_TABS.PERFORMANCE));
  });

  it('offers Performance to a reader holding it, in its place before Actions', () => {
    const tabs = studentTabsFor(
      rights([FEATURE_KEYS.STUDENT_MANAGEMENT, FEATURE_KEYS.STUDENT_PERFORMANCE]),
    );

    assert.deepEqual(tabs, [
      STUDENT_TABS.DETAILS,
      STUDENT_TABS.SERIES,
      STUDENT_TABS.EVENTS,
      STUDENT_TABS.PERFORMANCE,
      STUDENT_TABS.ACTIONS,
    ]);
  });
});

describe('the tab a URL asks for', () => {
  it('opens the one it names', () => {
    const held = rights([FEATURE_KEYS.STUDENT_MANAGEMENT]);

    assert.equal(openStudentTab(STUDENT_TABS.SERIES, held), STUDENT_TABS.SERIES);
  });

  /** A link shared by somebody holding more than the reader must not land on a blank strip. */
  it('falls back to Details when it names a tab this reader may not open', () => {
    const held = rights([FEATURE_KEYS.STUDENT_MANAGEMENT]);

    assert.equal(openStudentTab(STUDENT_TABS.PERFORMANCE, held), STUDENT_TABS.DETAILS);
  });

  it('falls back to Details when it names nothing at all', () => {
    const held = rights([FEATURE_KEYS.STUDENT_MANAGEMENT]);

    assert.equal(openStudentTab(undefined, held), STUDENT_TABS.DETAILS);
    assert.equal(openStudentTab('nonsense', held), STUDENT_TABS.DETAILS);
  });
});
