import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { TEST_STATUS } from '@iace/contracts';
import {
  applyOffer,
  offerChangesOf,
  savedOffer,
  type OfferDraft,
  type OfferWrites,
} from '../src/routes/test-offer-draft';

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
    moveTo: write('moveTo'),
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

  it('sets the opening on the series the test is moving to', async () => {
    const held = draftTest({
      series: { id: 'srs_2', name: 'SSC CHSL Mocks' },
      schedule: { opensAt: '2026-09-11T18:00', programs: [] },
    });

    assert.deepEqual(await done(draftTest(), held), [
      'moveTo srs_2',
      'setOpening srs_2 2026-09-11T12:30:00.000Z',
    ]);
  });

  it('retires a test before anything else about it moves', async () => {
    const saved = draftTest({ offered: true });
    const held = draftTest({ series: { id: 'srs_2', name: 'SSC CHSL Mocks' }, offered: false });

    assert.deepEqual(await done(saved, held), ['retire', 'moveTo srs_2']);
  });
});
