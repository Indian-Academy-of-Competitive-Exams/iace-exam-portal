import test from 'node:test';
import assert from 'node:assert/strict';
import { AppException, ErrorCodes } from '@iace/contracts';
import { isBriefRefused } from '../src/catalog';

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
