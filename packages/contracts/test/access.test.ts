import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  TEST_BUCKET,
  TEST_SERIES_KIND,
  createEventSchema,
  eventListQuerySchema,
  studentCatalogSeriesSchema,
  testAction,
  testBucket,
  testIsOpen,
  testWindow,
  type StudentCatalogTest,
} from '../src/access';
import { ME_ROUTES } from '../src/me';

const SERIES = {
  id: 'srs_1',
  name: 'SSC CGL Tier 1 mocks',
  description: null,
  examStage: { id: 'stage_1', name: 'Tier 1', examCode: 'SSC CGL', course: 'SSC' },
  programCode: null,
  kind: TEST_SERIES_KIND.STANDARD,
  sequentialTests: false,
  tests: [
    {
      id: 'tst_1',
      title: 'Mock 1',
      durationSec: 3600,
      totalQuestions: 100,
      totalMarks: 200,
      order: 1,
      opensAt: null,
      closesAt: null,
      attemptStatus: null,
      canStart: true,
      sittingCount: 1284,
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
    assert.equal(ME_ROUTES.readNotification('ntf_1'), '/me/notifications/ntf_1/read');
  });
});

describe('testBucket', () => {
  const NOW = new Date('2026-09-01T10:00:00.000Z');
  const test = (over: Partial<StudentCatalogTest> = {}): StudentCatalogTest => ({
    id: 'tst_1',
    title: 'Mock 1',
    durationSec: 3600,
    totalQuestions: 100,
    totalMarks: 200,
    order: 1,
    opensAt: null,
    closesAt: null,
    attemptStatus: null,
    canStart: true,
    sittingCount: null,
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

describe('createEventSchema', () => {
  /** The failure this prevents: a one-letter name nobody can pick out of a list. */
  it('refuses a one-character name', () => {
    assert.equal(createEventSchema.safeParse({ name: 'A' }).success, false);
  });

  it('accepts a name at the minimum length', () => {
    assert.equal(createEventSchema.parse({ name: 'AB' }).name, 'AB');
  });
});

describe('eventListQuerySchema', () => {
  it('coerces activeOnly from the query string', () => {
    assert.equal(eventListQuerySchema.parse({ activeOnly: 'true' }).activeOnly, true);
    assert.equal(eventListQuerySchema.parse({ activeOnly: 'false' }).activeOnly, false);
    assert.equal(eventListQuerySchema.parse({}).activeOnly, undefined);
  });
});
