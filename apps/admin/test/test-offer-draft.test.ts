import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { TEST_STATUS } from '@iace/contracts';
import {
  anyPassed,
  applyOffer,
  offerChangesOf,
  passedOpenings,
  savedOffer,
  type OfferDraft,
  type OfferWrites,
} from '../src/routes/test-offer-draft';
import type { ProgramOpening } from '../src/routes/test-schedule-draft';

const draftTest = (over: Partial<OfferDraft> = {}): OfferDraft => ({
  series: { id: 'srs_1', name: 'SSC CGL Mocks' },
  schedule: { opensAt: '', programs: [] },
  offered: false,
  ...over,
});

/** Records each write in the order Done made it, and refuses the one named. */
function recordedWrites(refuse?: keyof OfferWrites) {
  const calls: string[] = [];
  const write =
    (name: keyof OfferWrites) =>
    async (...args: unknown[]) => {
      if (name === refuse) throw new Error(`${name} refused`);
      calls.push([name, ...args].join(' '));
    };

  const writes: OfferWrites = {
    retire: write('retire'),
    setOpening: write('setOpening'),
    setProgramOpening: write('setProgramOpening'),
    clearProgramOpening: write('clearProgramOpening'),
    offer: write('offer'),
  };
  return { calls, writes };
}

const done = async (saved: OfferDraft, held: OfferDraft, refuse?: keyof OfferWrites) => {
  const { calls, writes } = recordedWrites(refuse);
  await applyOffer(held, offerChangesOf(saved, held), writes);
  return calls;
};

describe('the offer a test is read out of', () => {
  it('is offered only while the test is active', () => {
    const detail = {
      testSeriesId: 'srs_1',
      testSeriesName: 'SSC CGL Mocks',
      opensAt: null,
      programUnlocks: [],
    };

    assert.equal(savedOffer({ ...detail, status: TEST_STATUS.ACTIVE }).offered, true);
    assert.equal(savedOffer({ ...detail, status: TEST_STATUS.INACTIVE }).offered, false);
  });
});

describe('what Done writes, and in what order', () => {
  it('writes nothing when nothing was touched', async () => {
    assert.equal(offerChangesOf(draftTest(), draftTest()).count, 0);
    assert.deepEqual(await done(draftTest(), draftTest()), []);
  });

  it('saves the opening before it offers the test', async () => {
    const held = draftTest({
      schedule: { opensAt: '2026-09-11T18:00', programs: [] },
      offered: true,
    });

    assert.equal(offerChangesOf(draftTest(), held).count, 2);
    assert.deepEqual(await done(draftTest(), held), [
      'setOpening srs_1 2026-09-11T12:30:00.000Z',
      'offer',
    ]);
  });

  it('does not offer a test whose opening was refused', async () => {
    const held = draftTest({
      schedule: { opensAt: '2026-09-11T18:00', programs: [] },
      offered: true,
    });
    const { calls, writes } = recordedWrites('setOpening');

    await assert.rejects(applyOffer(held, offerChangesOf(draftTest(), held), writes));
    assert.deepEqual(calls, []);
  });

  it('retires a test before its opening moves', async () => {
    const saved = draftTest({ offered: true });
    const held = draftTest({ schedule: { opensAt: '2026-09-11T18:00', programs: [] } });

    assert.deepEqual(await done(saved, held), [
      'retire',
      'setOpening srs_1 2026-09-11T12:30:00.000Z',
    ]);
  });
});

describe('an opening Done would write that has already passed', () => {
  // 18:00 on 11 September at the institute.
  const NOW = new Date('2026-09-11T12:30:00.000Z');
  const opening = (opensAt: string, programs: readonly ProgramOpening[] = []) =>
    draftTest({ schedule: { opensAt, programs } });

  it('is caught when the time given is not ahead of now, down to the minute', () => {
    const passed = passedOpenings(draftTest(), opening('2026-09-11T18:00'), NOW);

    assert.equal(passed.opening, true);
    assert.equal(anyPassed(passed), true);
  });

  it('lets a time ahead of now through', () => {
    assert.equal(anyPassed(passedOpenings(draftTest(), opening('2026-09-11T18:01'), NOW)), false);
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
