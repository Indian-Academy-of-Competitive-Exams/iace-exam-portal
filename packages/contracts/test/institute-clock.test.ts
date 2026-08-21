/** One clock for the platform: what day it is, and what a wall-clock time means as an instant. */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  INSTITUTE_TIME_ZONE,
  civilDate,
  fromInstituteWallTime,
  instituteWallTime,
} from '../src/common';

describe('the institute clock', () => {
  it('names one zone for everything', () => {
    assert.equal(INSTITUTE_TIME_ZONE, 'Asia/Kolkata');
  });

  it('reads the date off the wall in India, not off UTC', () => {
    const beforeDawnIST = new Date('2026-08-20T20:30:00Z');
    assert.equal(civilDate(beforeDawnIST), '2026-08-21');
    assert.equal(beforeDawnIST.toISOString().slice(0, 10), '2026-08-20');
  });

  it('turns an instant into the wall time an admin would read', () => {
    assert.equal(instituteWallTime(new Date('2026-08-21T03:30:00Z')), '2026-08-21T09:00');
  });

  it('turns a wall time back into the instant it names', () => {
    assert.equal(
      fromInstituteWallTime('2026-08-21T09:00').toISOString(),
      '2026-08-21T03:30:00.000Z',
    );
  });

  it('puts institute midnight 5.5 hours before UTC midnight', () => {
    assert.equal(
      fromInstituteWallTime('2026-08-21T00:00').toISOString(),
      '2026-08-20T18:30:00.000Z',
    );
  });

  it('round-trips, so editing a schedule and saving it does not move it', () => {
    for (const wall of ['2026-01-01T00:00', '2026-06-15T13:45', '2026-12-31T23:59']) {
      assert.equal(instituteWallTime(fromInstituteWallTime(wall)), wall);
    }
  });

  it('takes a wall time with no minutes, which a bare date field produces', () => {
    assert.equal(fromInstituteWallTime('2026-08-21').toISOString(), '2026-08-20T18:30:00.000Z');
  });
});
