import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DUE_STANDINGS, dueStanding } from '../src/index';

/** Due on the 9th, kept as that day's last instant at the institute. */
const DUE = '2026-10-09T18:29:59.999Z';

describe('dueStanding', () => {
  it('judges nothing without a due day', () => {
    assert.equal(dueStanding({ dueAt: null, finalizedAt: null }, '2026-12-01'), null);
    assert.equal(dueStanding({ dueAt: null, finalizedAt: DUE }, '2026-12-01'), null);
  });

  it('leaves an open section alone until its due day is over', () => {
    assert.equal(dueStanding({ dueAt: DUE, finalizedAt: null }, '2026-10-09'), null);
    assert.equal(
      dueStanding({ dueAt: DUE, finalizedAt: null }, '2026-10-10'),
      DUE_STANDINGS.OVERDUE,
    );
  });

  /** The failure this prevents: 23:30 IST on the due day is the NEXT day in UTC, and read as late. */
  it('counts a finish late on the due day at the institute as on time', () => {
    const lateEvening = '2026-10-09T18:00:00.000Z';
    const pastMidnight = '2026-10-09T18:30:00.000Z';

    assert.equal(dueStanding({ dueAt: DUE, finalizedAt: lateEvening }), DUE_STANDINGS.ON_TIME);
    assert.equal(dueStanding({ dueAt: DUE, finalizedAt: pastMidnight }), DUE_STANDINGS.LATE);
  });

  it('reads a due day kept at UTC midnight, as rows from before were, as the same day', () => {
    const before = '2026-10-09T00:00:00.000Z';

    assert.equal(
      dueStanding({ dueAt: before, finalizedAt: '2026-10-09T12:00:00.000Z' }),
      DUE_STANDINGS.ON_TIME,
    );
  });
});
