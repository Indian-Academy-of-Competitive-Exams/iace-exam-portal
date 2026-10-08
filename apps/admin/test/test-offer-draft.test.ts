import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { TEST_STATUS } from '@iace/contracts';
import {
  anyPassed,
  heldOffer,
  offerChangesOf,
  offeringBodyOf,
  passedOpenings,
  savedOffer,
  switchedOffering,
  type OfferDraft,
} from '../src/features/tests/test-offer-draft';
import type { ProgramOpening } from '../src/features/tests/test-schedule-draft';

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

describe('the switch on the series test list', () => {
  const live = {
    testSeriesId: 'srs_1',
    testSeriesName: 'SSC CGL Mocks',
    status: TEST_STATUS.ACTIVE,
    opensAt: '2026-09-11T12:30:00.000Z',
    programUnlocks: [{ programCode: 'SSC 2026', opensAt: '2026-09-11T03:30:00.000Z' }],
    version: 9,
  };

  /** The failure this prevents: a test made inactive from the list coming back with its opening moved or its early programs gone. */
  it('moves whether it is offered and sends the opening and its programs back as they were held', () => {
    assert.deepEqual(switchedOffering(live, false), {
      opensAt: live.opensAt,
      programOpenings: live.programUnlocks,
      offered: false,
      expectedVersion: 9,
    });
  });

  it('offers an inactive test again on the version it was read at', () => {
    const idle = { ...live, status: TEST_STATUS.INACTIVE, opensAt: null, programUnlocks: [] };

    assert.deepEqual(switchedOffering(idle, true), {
      opensAt: null,
      programOpenings: [],
      offered: true,
      expectedVersion: 9,
    });
  });

  /** A stored instant carries seconds; the server compares to the minute, so the same minute must come back. */
  it('sends back the minute an opening was stored at', () => {
    const stamped = { ...live, opensAt: '2026-09-11T12:30:45.123Z' };

    assert.equal(switchedOffering(stamped, false).opensAt, '2026-09-11T12:30:00.000Z');
  });
});

describe('the offer the step holds', () => {
  const saved = draftTest({ schedule: { opensAt: '2026-09-12T10:00', programs: [] } });
  const draft = draftTest({
    schedule: { opensAt: '2026-09-14T10:00', programs: [] },
    offered: true,
  });

  it('is the draft while nobody has sat the test, and the saved test with no draft', () => {
    assert.equal(heldOffer(saved, draft, false), draft);
    assert.equal(heldOffer(saved, null, true), saved);
  });

  /** The failure this prevents: Done sending a refused opening again from a field that can no longer be edited. */
  it('gives a new opening back once the test is sat, and keeps the rest of the draft', () => {
    const held = heldOffer(saved, draft, true);

    assert.equal(held.schedule.opensAt, saved.schedule.opensAt);
    assert.equal(offerChangesOf(saved, held).schedule.opening, false);
    assert.equal(held.offered, true);
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
