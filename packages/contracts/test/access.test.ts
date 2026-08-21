import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  SERIES_AVAILABILITIES,
  SERIES_AVAILABILITY,
  studentCatalogSeriesSchema,
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
  availability: SERIES_AVAILABILITY.ACTIVE,
  startAt: null,
  endAt: null,
  prerequisiteSeriesId: null,
  prerequisiteSeriesName: null,
  canRequestUnlock: false,
  tests: [{ id: 'tst_1', title: 'Mock 1', order: 1, canStart: true }],
};

describe('studentCatalogSeriesSchema', () => {
  it('reads a series the student can sit right now', () => {
    const parsed = studentCatalogSeriesSchema.parse(SERIES);

    assert.equal(parsed.availability, SERIES_AVAILABILITY.ACTIVE);
    assert.equal(parsed.tests[0]?.canStart, true);
  });

  /**
   * The failure this prevents: both are DERIVED from the clock on every read, so a client that
   * could receive a payload without them would have to guess, and a guess is a locked-out student.
   */
  it('refuses a series with no availability, and a test with no canStart', () => {
    const { availability: _availability, ...noAvailability } = SERIES;
    assert.equal(studentCatalogSeriesSchema.safeParse(noAvailability).success, false);

    assert.equal(
      studentCatalogSeriesSchema.safeParse({
        ...SERIES,
        tests: [{ id: 'tst_1', title: 'Mock 1', order: 1 }],
      }).success,
      false,
    );
  });

  it('names the three windows a branch can put a series in', () => {
    assert.deepEqual([...SERIES_AVAILABILITIES].sort(), ['ACTIVE', 'ENDED', 'UPCOMING']);
  });
});

describe('ME_ROUTES.catalog', () => {
  /** No id in the path: the subject is always the token's student — see the controller. */
  it('carries no student id', () => {
    assert.equal(ME_ROUTES.catalog, '/me/catalog');
  });
});
