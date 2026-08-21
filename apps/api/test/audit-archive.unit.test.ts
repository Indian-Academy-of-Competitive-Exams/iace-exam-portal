import assert from 'node:assert/strict';
import { gunzipSync } from 'node:zlib';
import { describe, it } from 'node:test';
import { AppException, ErrorCodes } from '@iace/contracts';
import {
  AUDIT_RETENTION_DAYS,
  archiveKeyFor,
  dayToArchive,
  toNdjson,
} from '../src/audit/audit-archive';

describe('archiveKeyFor', () => {
  /** Derived from the date alone, so finding a day needs no index and no tool. */
  it('keys an object by its institute day, zero-padded', () => {
    assert.equal(
      archiveKeyFor(new Date('2026-03-07T00:00:00Z')),
      'audit/row-actions/2026/03/07.ndjson.gz',
    );
  });

  it('keys by the institute day, so an evening-UTC row files under the next day', () => {
    // 23:30 UTC on the 7th is already 05:00 on the 8th in India, and belongs to the 8th.
    assert.equal(
      archiveKeyFor(new Date('2026-03-07T23:30:00Z')),
      'audit/row-actions/2026/03/08.ndjson.gz',
    );
  });
});

describe('toNdjson', () => {
  it('writes one JSON object per line, gzipped', () => {
    const buffer = toNdjson([{ id: 'a' }, { id: 'b' }]);
    const lines = gunzipSync(buffer).toString('utf8').trim().split('\n');

    assert.deepEqual(
      lines.map((line) => JSON.parse(line)),
      [{ id: 'a' }, { id: 'b' }],
    );
  });

  /** A row whose JSON contained a newline would otherwise split into two unparseable lines. */
  it('keeps a row on one line even when a value contains a newline', () => {
    const buffer = toNdjson([{ note: 'first\nsecond' }]);
    const lines = gunzipSync(buffer).toString('utf8').trim().split('\n');

    assert.equal(lines.length, 1);
    assert.equal(JSON.parse(lines[0]!).note, 'first\nsecond');
  });

  it('produces empty output for empty input, not a blank line', () => {
    const buffer = toNdjson([]);

    assert.equal(gunzipSync(buffer).toString('utf8'), '');
  });
});

describe('dayToArchive', () => {
  it('is the retention boundary, at institute midnight', () => {
    const day = dayToArchive(new Date('2026-04-10T13:45:00Z'), AUDIT_RETENTION_DAYS);

    assert.equal(day.toISOString(), '2026-03-10T18:30:00.000Z');
  });

  /**
   * The failure this prevents: archiving today would flush rows out from under requests still
   * adding to it, and the object would be missing everything written after the job ran.
   */
  it('never returns today', () => {
    const now = new Date('2026-04-10T13:45:00Z');

    assert.ok(dayToArchive(now, AUDIT_RETENTION_DAYS).getTime() < now.getTime());
  });

  it('never returns today, even when now is exactly midnight UTC', () => {
    const now = new Date('2026-04-10T00:00:00.000Z');

    assert.ok(dayToArchive(now, AUDIT_RETENTION_DAYS).getTime() < now.getTime());
  });

  it('refuses a retention window under a day, rather than return today', () => {
    assert.throws(
      () => dayToArchive(new Date('2026-04-10T13:45:00Z'), 0),
      (error: unknown) => {
        assert.ok(AppException.is(error));
        assert.equal(error.code, ErrorCodes.VALIDATION_ERROR);
        return true;
      },
    );
  });
});
