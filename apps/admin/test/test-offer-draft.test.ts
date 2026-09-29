import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { TEST_STATUS } from '@iace/contracts';
import {
  anyPassed,
  offerChangesOf,
  offeringBodyOf,
  passedOpenings,
  savedOffer,
  type OfferDraft,
} from '../src/routes/test-offer-draft';
import type { ProgramOpening } from '../src/routes/test-schedule-draft';

const draftTest = (over: Partial<OfferDraft> = {}): OfferDraft => ({
  series: { id: 'srs_1', name: 'SSC CGL Mocks' },
  schedule: { opensAt: '', programs: [] },
  offered: false,
  version: 3,
  ...over,
});

describe('the offer a test is read out of', () => {
  it('is offered only while the test is active', () => {
    const detail = {
      testSeriesId: 'srs_1',
      testSeriesName: 'SSC CGL Mocks',
      opensAt: null,
      programUnlocks: [],
      version: 1,
    };

    assert.equal(savedOffer({ ...detail, status: TEST_STATUS.ACTIVE }).offered, true);
    assert.equal(savedOffer({ ...detail, status: TEST_STATUS.INACTIVE }).offered, false);
  });
});

describe('what Done sends', () => {
  it('counts no change when nothing was touched', () => {
    assert.equal(offerChangesOf(draftTest(), draftTest()).count, 0);
  });

  /** The whole held step goes in one request, so the server can refuse it whole. */
  it('sends the opening as an instant, the timed program openings, and whether it is offered', () => {
    const held = draftTest({
      schedule: {
        opensAt: '2026-09-11T18:00',
        programs: [
          { programCode: 'SSC 2026', opensAt: '2026-09-11T09:00' },
          { programCode: 'RRB JE', opensAt: '' },
        ],
      },
      offered: true,
    });

    assert.deepEqual(offeringBodyOf(held), {
      opensAt: '2026-09-11T12:30:00.000Z',
      programOpenings: [{ programCode: 'SSC 2026', opensAt: '2026-09-11T03:30:00.000Z' }],
      offered: true,
      expectedVersion: 3,
    });
  });

  it('sends a blank opening as none, which opens the test with its series', () => {
    assert.equal(offeringBodyOf(draftTest()).opensAt, null);
  });
});

describe('an opening Done would write that is not far enough ahead', () => {
  // 18:00 on 11 September at the institute.
  const NOW = new Date('2026-09-11T12:30:00.000Z');
  const opening = (opensAt: string, programs: readonly ProgramOpening[] = []) =>
    draftTest({ schedule: { opensAt, programs } });

  it('is caught when the time given is not ahead of now, down to the minute', () => {
    const passed = passedOpenings(draftTest(), opening('2026-09-11T18:00'), NOW);

    assert.equal(passed.opening, true);
    assert.equal(anyPassed(passed), true);
  });

  /** A sitting may begin five minutes early, so an opening four minutes out is already open. */
  it('is caught when the time given lands inside the start grace', () => {
    assert.equal(anyPassed(passedOpenings(draftTest(), opening('2026-09-11T18:04'), NOW)), true);
  });

  it('lets a time past the grace through', () => {
    assert.equal(anyPassed(passedOpenings(draftTest(), opening('2026-09-11T18:06'), NOW)), false);
  });

  it('does not judge again an opening that was saved and has since passed', () => {
    const saved = opening('2026-09-01T10:00');

    assert.equal(anyPassed(passedOpenings(saved, { ...saved, offered: true }, NOW)), false);
  });

  it('leaves a blank opening alone', () => {
    const passed = passedOpenings(opening('2026-09-12T10:00'), opening(''), NOW);

    assert.equal(anyPassed(passed), false);
  });

  it('names the program whose new time has passed', () => {
    const saved = opening('2026-09-12T10:00');
    const held = opening('2026-09-12T10:00', [
      { programCode: 'SSC 2026', opensAt: '2026-09-11T09:00' },
      { programCode: 'RRB JE', opensAt: '2026-09-12T09:00' },
    ]);

    assert.deepEqual([...passedOpenings(saved, held, NOW).programs], ['SSC 2026']);
  });
});
