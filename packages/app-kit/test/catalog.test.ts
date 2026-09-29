import test from 'node:test';
import assert from 'node:assert/strict';
import { AppException, ErrorCodes, type SatSitting } from '@iace/contracts';
import { everySitting, isBriefRefused, resultsByTest } from '../src/catalog';

test('a brief the server will not show this student is a refusal', () => {
  assert.equal(isBriefRefused(new AppException(ErrorCodes.NOT_FOUND)), true, 'an unreachable test');
  assert.equal(isBriefRefused(new AppException(ErrorCodes.FORBIDDEN)), true, 'not a student');
});

test('a brief that failed to arrive is not a refusal, so the gate offers a retry', () => {
  const offline = new AppException(ErrorCodes.INTERNAL, 'Cannot reach the server.', {
    httpStatus: 0,
  });
  assert.equal(isBriefRefused(offline), false, 'no network');
  assert.equal(isBriefRefused(new AppException(ErrorCodes.INTERNAL)), false, 'a 5xx');
  assert.equal(isBriefRefused(new AppException(ErrorCodes.SERVICE_UNAVAILABLE)), false);
  assert.equal(isBriefRefused(new AppException(ErrorCodes.RATE_LIMITED)), false);
  assert.equal(isBriefRefused(new Error('socket hang up')), false);
  assert.equal(isBriefRefused({ code: ErrorCodes.NOT_FOUND }), false, 'a look-alike is not one');
});

const satOn = (attemptId: string, testId: string): SatSitting => ({
  attemptId,
  attemptNo: 1,
  isGraded: true,
  testId,
  testTitle: 'A paper',
  submittedAt: '2026-09-01T10:00:00.000Z',
  score: 40,
  maxMarks: 100,
  percentage: 40,
  accuracy: 80,
});

test('every sitting reaches a tile, and only the charted ones carry a standing', () => {
  const old = satOn('old', 'paper-a');
  const recent = satOn('recent', 'paper-b');
  const trend = {
    testsSat: 2,
    points: [{ ...recent, rank: 3, percentile: 91 }],
    sittings: [old, recent],
  };

  const results = resultsByTest(everySitting(trend));

  assert.deepEqual(results.get('paper-a'), {
    attemptId: 'old',
    score: 40,
    maxMarks: 100,
    percentile: null,
  });
  assert.equal(results.get('paper-b')?.percentile, 91);
  assert.deepEqual(everySitting(undefined), []);
});
