import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  changesOf,
  instantOf,
  savedSchedule,
  wallOf,
  type ScheduleDraft,
} from '../src/routes/test-schedule-draft';

const draft = (over: Partial<ScheduleDraft> = {}): ScheduleDraft => ({
  opensAt: '2026-09-10T09:00',
  extraTime: '',
  programs: [{ programCode: 'SSC 2026', opensAt: '2026-09-10T08:00' }],
  ...over,
});

describe('the schedule a test is read out of', () => {
  it('says the institute clock, not UTC', () => {
    const held = savedSchedule({
      opensAt: '2026-09-10T03:30:00.000Z',
      extraTimeSec: 900,
      programUnlocks: [{ programCode: 'SSC 2026', opensAt: '2026-09-10T02:30:00.000Z' }],
    });

    assert.equal(held.opensAt, '2026-09-10T09:00');
    assert.equal(held.extraTime, '15');
    assert.deepEqual(held.programs, [{ programCode: 'SSC 2026', opensAt: '2026-09-10T08:00' }]);
  });

  it('sends back the instant it was given', () => {
    assert.equal(instantOf(wallOf('2026-09-10T03:30:00.000Z')), '2026-09-10T03:30:00.000Z');
  });

  it('reads no opening as nothing chosen', () => {
    assert.equal(wallOf(null), '');
  });
});

describe('what the schedule step would save', () => {
  it('has nothing to do when nothing was touched', () => {
    const changes = changesOf(draft(), draft());

    assert.equal(changes.count, 0);
    assert.equal(changes.opening, false);
    assert.equal(changes.timing, false);
    assert.deepEqual(changes.written, []);
    assert.deepEqual(changes.cleared, []);
  });

  it('counts a moved opening', () => {
    const changes = changesOf(draft(), draft({ opensAt: '2026-09-10T10:00' }));

    assert.equal(changes.opening, true);
    assert.equal(changes.count, 1);
  });

  it('counts extra time as the one write it is', () => {
    const changes = changesOf(draft(), draft({ extraTime: '10' }));

    assert.equal(changes.timing, true);
    assert.equal(changes.count, 1);
  });

  it('writes a program given a time it did not have', () => {
    const changes = changesOf(
      draft({ programs: [] }),
      draft({ programs: [{ programCode: 'RRB JE', opensAt: '2026-09-10T07:00' }] }),
    );

    assert.deepEqual(changes.written, [{ programCode: 'RRB JE', opensAt: '2026-09-10T07:00' }]);
    assert.deepEqual(changes.cleared, []);
    assert.equal(changes.count, 1);
  });

  it('writes a program whose time moved', () => {
    const changes = changesOf(
      draft(),
      draft({ programs: [{ programCode: 'SSC 2026', opensAt: '2026-09-10T07:30' }] }),
    );

    assert.deepEqual(changes.written, [{ programCode: 'SSC 2026', opensAt: '2026-09-10T07:30' }]);
    assert.equal(changes.count, 1);
  });

  it('clears a program taken off the list', () => {
    const changes = changesOf(draft(), draft({ programs: [] }));

    assert.deepEqual(changes.cleared, ['SSC 2026']);
    assert.deepEqual(changes.written, []);
    assert.equal(changes.count, 1);
  });

  it('clears a program whose time was emptied, which is the same ask', () => {
    const changes = changesOf(
      draft(),
      draft({ programs: [{ programCode: 'SSC 2026', opensAt: '' }] }),
    );

    assert.deepEqual(changes.cleared, ['SSC 2026']);
    assert.deepEqual(changes.written, []);
    assert.equal(changes.count, 1);
  });

  it('has nothing to write for a program added but never given a time', () => {
    const changes = changesOf(
      draft({ programs: [] }),
      draft({ programs: [{ programCode: 'RRB JE', opensAt: '' }] }),
    );

    assert.deepEqual(changes.written, []);
    assert.deepEqual(changes.cleared, []);
    assert.equal(changes.count, 0);
  });

  it('adds every kind of change up', () => {
    const changes = changesOf(
      draft(),
      draft({
        opensAt: '2026-09-10T10:00',
        extraTime: '20',
        programs: [{ programCode: 'RRB JE', opensAt: '2026-09-10T07:00' }],
      }),
    );

    assert.equal(changes.count, 4);
    assert.deepEqual(changes.cleared, ['SSC 2026']);
  });
});
