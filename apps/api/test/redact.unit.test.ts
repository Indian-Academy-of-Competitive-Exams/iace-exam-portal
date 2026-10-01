import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { endpointHost, maskedMobile, redact } from '../src/common/redact';

describe('redact', () => {
  it('keeps everything a 500 is actually debugged from', () => {
    assert.deepEqual(redact({ testId: 'abc', count: 3, valid: false, missing: null }), {
      testId: 'abc',
      count: 3,
      valid: false,
      missing: null,
    });
  });

  /** instrument.ts sets sendDefaultPii: false for this; a body attached by hand must not undo it. */
  it('scrubs a secret however the key is spelled, at any depth', () => {
    const scrubbed = redact({
      pin: '1234',
      PIN: '1234',
      newPin: '5678',
      mobileNumber: '9876543210',
      student_email: 'a@b.com',
      refreshToken: 'eyJ',
      profile: { dob: '2001-04-01', aadhaar: '1111', name: 'Asha' },
    }) as Record<string, unknown>;

    assert.deepEqual(scrubbed, {
      pin: '[redacted]',
      PIN: '[redacted]',
      newPin: '[redacted]',
      mobileNumber: '[redacted]',
      student_email: '[redacted]',
      refreshToken: '[redacted]',
      profile: { dob: '[redacted]', aadhaar: '[redacted]', name: 'Asha' },
    });
  });

  /** `panel` contains `pan`, and a word-boundary match is the difference between that and a redacted screen. */
  it('does not scrub a key that merely contains a secret word', () => {
    assert.deepEqual(redact({ expandedPanel: true, pincode: '500001' }), {
      expandedPanel: true,
      pincode: '500001',
    });
  });

  it('bounds a body that would otherwise fill the disk', () => {
    const big = redact({ notes: 'x'.repeat(5_000) }) as { truncated?: string };

    assert.equal(typeof big.truncated, 'string');
    assert.equal(big.truncated?.length, 2_000);
  });

  it('stops descending rather than following a body of arbitrary depth', () => {
    let deep: Record<string, unknown> = { floor: true };
    for (let level = 0; level < 12; level += 1) deep = { nested: deep };

    assert.ok(JSON.stringify(redact(deep))?.includes('[deep]'));
  });

  it('caps an array instead of logging every row of an import', () => {
    const rows = Array.from({ length: 200 }, (_, index) => ({ index }));

    assert.equal((redact({ rows }) as { rows: unknown[] }).rows.length, 20);
  });

  it('passes a body-less request through untouched', () => {
    assert.equal(redact(undefined), undefined);
    assert.deepEqual(redact({}), {});
  });
});

describe('maskedMobile', () => {
  /** An error log has to name SOMEBODY, and the last four digits find the row without being the number. */
  it('keeps the last four digits and nothing before them', () => {
    assert.equal(maskedMobile('9876543210'), '****3210');
    assert.equal(maskedMobile('+91 98765 43210'), '****3210');
  });

  it('gives away nothing at all when there is too little to mask', () => {
    assert.equal(maskedMobile('123'), '****');
    assert.equal(maskedMobile(''), '****');
  });
});

describe('endpointHost', () => {
  /** The path of a push endpoint IS the credential for pushing to that device; the host is just the vendor. */
  it('keeps the service and drops the device credential', () => {
    assert.equal(
      endpointHost('https://fcm.googleapis.com/fcm/send/dXNlci1zZWNyZXQtdG9rZW4'),
      'fcm.googleapis.com',
    );
  });

  it('says so rather than echoing something it could not parse', () => {
    assert.equal(endpointHost('not a url'), 'an unparseable endpoint');
  });
});
