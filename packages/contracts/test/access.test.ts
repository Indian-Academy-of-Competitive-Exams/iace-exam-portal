import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  decideUnlockRequestSchema,
  TEST_BUCKET,
  testAction,
  testBucket,
  type StudentCatalogTest,
  studentCatalogSeriesSchema,
  testIsOpen,
  testWindow,
  UNLOCK_REQUEST_STATUS,
} from '../src/access';
import { ME_ROUTES } from '../src/me';

const SERIES = {
  id: 'srs_1',
  name: 'SSC CGL Tier 1 mocks',
  description: null,
  examStage: { id: 'stage_1', name: 'Tier 1', examCode: 'SSC CGL' },
  programCode: null,
  isFree: false,
  sequentialTests: false,
  unlockMode: 'AUTO',
  unlockState: 'UNLOCKED',
  prerequisiteSeriesId: null,
  prerequisiteSeriesName: null,
  canRequestUnlock: false,
  tests: [
    {
      id: 'tst_1',
      title: 'Mock 1',
      order: 1,
      opensAt: null,
      closesAt: null,
      attemptStatus: null,
      canStart: true,
    },
  ],
};

describe('studentCatalogSeriesSchema', () => {
  it('reads a series the student can sit right now', () => {
    const parsed = studentCatalogSeriesSchema.parse(SERIES);

    assert.equal(parsed.tests[0]?.canStart, true);
    assert.equal(parsed.tests[0]?.opensAt, null);
  });

  /** The failure this prevents: a client left guessing at `canStart`, and a guess locks a student out. */
  it('refuses a test with no canStart and no window', () => {
    assert.equal(
      studentCatalogSeriesSchema.safeParse({
        ...SERIES,
        tests: [{ id: 'tst_1', title: 'Mock 1', order: 1 }],
      }).success,
      false,
    );
  });

  /** Timing is the test's now: a series that carried a window would be a second answer. */
  it('carries no window of its own', () => {
    const parsed = studentCatalogSeriesSchema.parse({ ...SERIES, startAt: '2026-09-01T00:00:00Z' });

    assert.equal('startAt' in parsed, false);
    assert.equal('availability' in parsed, false);
  });
});

describe('testWindow', () => {
  const UNLOCK = '2026-09-01T04:30:00.000Z';

  it('opens when the link says and never closes on its own', () => {
    assert.deepEqual(testWindow({ unlockAt: UNLOCK, lateEntrySec: null }), {
      opensAt: UNLOCK,
      closesAt: null,
    });
  });

  it('closes a branch cutoff after the unlock, not after the wall clock', () => {
    const window = testWindow({ unlockAt: UNLOCK, lateEntrySec: 30 * 60 });

    assert.equal(window.closesAt, '2026-09-01T05:00:00.000Z');
  });

  /** The failure this prevents: a cutoff counted from nothing, shutting a test that never opened. */
  it('is no cutoff at all when the test has no unlock time', () => {
    assert.deepEqual(testWindow({ unlockAt: null, lateEntrySec: 1800 }), {
      opensAt: null,
      closesAt: null,
    });
  });
});

describe('testIsOpen', () => {
  const at = (iso: string) => new Date(iso);
  const window = testWindow({ unlockAt: '2026-09-01T04:30:00.000Z', lateEntrySec: 1800 });

  it('is shut a millisecond before it opens and open at the instant it does', () => {
    assert.equal(testIsOpen(window, at('2026-09-01T04:29:59.999Z')), false);
    assert.equal(testIsOpen(window, at('2026-09-01T04:30:00.000Z')), true);
  });

  it('is open a millisecond before entry closes and shut at the instant it does', () => {
    assert.equal(testIsOpen(window, at('2026-09-01T04:59:59.999Z')), true);
    assert.equal(testIsOpen(window, at('2026-09-01T05:00:00.000Z')), false);
  });

  it('is open at any instant when the test has no window', () => {
    assert.equal(
      testIsOpen({ opensAt: null, closesAt: null }, at('1999-01-01T00:00:00.000Z')),
      true,
    );
  });
});

describe('ME_ROUTES.catalog', () => {
  /** No id in the path: the subject is always the token's student — see the controller. */
  it('carries no student id', () => {
    assert.equal(ME_ROUTES.catalog, '/me/catalog');
    assert.equal(ME_ROUTES.requestUnlock('srs_1'), '/me/series/srs_1/unlock-request');
    assert.equal(ME_ROUTES.readNotification('ntf_1'), '/me/notifications/ntf_1/read');
  });
});

describe('decideUnlockRequestSchema', () => {
  it('takes the two answers an admin can give', () => {
    assert.equal(
      decideUnlockRequestSchema.parse({ status: UNLOCK_REQUEST_STATUS.APPROVED }).status,
      UNLOCK_REQUEST_STATUS.APPROVED,
    );
    assert.equal(
      decideUnlockRequestSchema.parse({ status: UNLOCK_REQUEST_STATUS.REJECTED }).status,
      UNLOCK_REQUEST_STATUS.REJECTED,
    );
  });

  /** PENDING is where a request starts. Deciding it back to "undecided" is not an answer. */
  it('refuses PENDING as a decision', () => {
    assert.equal(
      decideUnlockRequestSchema.safeParse({ status: UNLOCK_REQUEST_STATUS.PENDING }).success,
      false,
    );
  });
});

describe('testBucket', () => {
  const NOW = new Date('2026-09-01T10:00:00.000Z');
  const test = (over: Partial<StudentCatalogTest> = {}): StudentCatalogTest => ({
    id: 'tst_1',
    title: 'Mock 1',
    order: 1,
    opensAt: null,
    closesAt: null,
    attemptStatus: null,
    canStart: true,
    ...over,
  });

  it('is open when the student may start it now', () => {
    assert.equal(testBucket(test(), NOW), TEST_BUCKET.OPEN);
  });

  it('is later when it has not opened yet', () => {
    const upcoming = test({ canStart: false, opensAt: '2026-09-02T04:30:00.000Z' });

    assert.equal(testBucket(upcoming, NOW), TEST_BUCKET.LATER);
  });

  /** Waiting its turn in a sequential series has no window at all — it is still Later, not Missed. */
  it('is later when it is waiting its turn', () => {
    assert.equal(testBucket(test({ canStart: false }), NOW), TEST_BUCKET.LATER);
  });

  /** The failure this prevents: a chance that has gone filed under "not yet". */
  it('is missed once entry has closed and nothing was sat', () => {
    const gone = test({ canStart: false, closesAt: '2026-09-01T09:00:00.000Z' });

    assert.equal(testBucket(gone, NOW), TEST_BUCKET.MISSED);
  });

  it('is done once a sitting was submitted, even with a retake left', () => {
    const sat = test({ attemptStatus: 'SUBMITTED', canStart: true });

    assert.equal(testBucket(sat, NOW), TEST_BUCKET.DONE);
    assert.equal(testAction(sat), 'START');
  });

  it('counts an evaluated sitting as done too', () => {
    assert.equal(testBucket(test({ attemptStatus: 'EVALUATED' }), NOW), TEST_BUCKET.DONE);
  });

  /** A running sitting is resumed, never started a second time. */
  it('offers Resume for a sitting still in progress', () => {
    const live = test({ attemptStatus: 'IN_PROGRESS' });

    assert.equal(testBucket(live, NOW), TEST_BUCKET.OPEN);
    assert.equal(testAction(live), 'RESUME');
  });

  it('offers nothing on a test that cannot be started', () => {
    assert.equal(testAction(test({ canStart: false })), null);
  });
});
