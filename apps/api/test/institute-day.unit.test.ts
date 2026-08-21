/** Every civil date is a day at the institute; a UTC day is 5.5 hours out and lands on the wrong one. */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { INSTITUTE_TIME_ZONE, civilDate, todayISO } from '@iace/contracts';
import { endOfInstituteDay, startOfInstituteDay } from '../src/common/time/institute-day';

describe('civilDate', () => {
  it('is the date on the wall in India, not the date at Greenwich', () => {
    const earlyMorningIST = new Date('2026-08-20T20:30:00Z');
    assert.equal(civilDate(earlyMorningIST), '2026-08-21');
    assert.equal(earlyMorningIST.toISOString().slice(0, 10), '2026-08-20');
  });

  it('holds the same date right up to IST midnight', () => {
    assert.equal(civilDate(new Date('2026-08-20T18:29:59Z')), '2026-08-20');
    assert.equal(civilDate(new Date('2026-08-20T18:30:00Z')), '2026-08-21');
  });

  it('formats as YYYY-MM-DD, which is what every date field takes', () => {
    assert.match(todayISO(), /^\d{4}-\d{2}-\d{2}$/);
  });

  it('names one zone for the whole platform', () => {
    assert.equal(INSTITUTE_TIME_ZONE, 'Asia/Kolkata');
  });
});

describe('institute day bounds', () => {
  it('starts a day at IST midnight', () => {
    assert.equal(startOfInstituteDay('2026-08-21').toISOString(), '2026-08-20T18:30:00.000Z');
  });

  it('ends a day at the last instant before the next IST midnight', () => {
    assert.equal(endOfInstituteDay('2026-08-21').toISOString(), '2026-08-21T18:29:59.999Z');
  });

  it('covers exactly one day, with no gap into the next', () => {
    const start = startOfInstituteDay('2026-08-21').getTime();
    const end = endOfInstituteDay('2026-08-21').getTime();
    assert.equal(end - start, 86_400_000 - 1);
    assert.equal(startOfInstituteDay('2026-08-22').getTime() - end, 1);
  });

  it('holds a record created just after IST midnight inside that day, not the one before', () => {
    const justAfterMidnightIST = new Date('2026-08-20T18:31:00Z');
    assert.ok(justAfterMidnightIST >= startOfInstituteDay('2026-08-21'));
    assert.ok(justAfterMidnightIST <= endOfInstituteDay('2026-08-21'));
    assert.ok(justAfterMidnightIST > endOfInstituteDay('2026-08-20'));
  });

  it('is unaffected by the server own zone, which is the point of naming one', () => {
    assert.equal(startOfInstituteDay('2026-01-15').toISOString(), '2026-01-14T18:30:00.000Z');
    assert.equal(startOfInstituteDay('2026-07-15').toISOString(), '2026-07-14T18:30:00.000Z');
  });
});
