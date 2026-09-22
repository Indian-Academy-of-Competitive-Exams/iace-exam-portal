import test from 'node:test';
import assert from 'node:assert/strict';
import { AppException, ErrorCodes, LANGUAGE_CODE } from '@iace/contracts';
import { examLanguagesFrom, isBriefRefused } from '../src/lib/exam-routes';

test('a valid language list parses in the order it was given', () => {
  assert.deepEqual(examLanguagesFrom('HI,EN'), [LANGUAGE_CODE.HI, LANGUAGE_CODE.EN]);
});

test('a code outside the closed language enum is dropped', () => {
  assert.deepEqual(examLanguagesFrom('EN,FR,TE'), [LANGUAGE_CODE.EN, LANGUAGE_CODE.TE]);
  assert.deepEqual(
    examLanguagesFrom('en'),
    [],
    'the enum is exact, so a lowercase code is refused',
  );
});

test('a hostile deep link keeps only the valid codes', () => {
  assert.deepEqual(examLanguagesFrom('EN,<script>,XX'), [LANGUAGE_CODE.EN]);
  assert.deepEqual(examLanguagesFrom('__proto__,constructor, EN'), []);
});

test('an empty or missing param gives no languages, so the server picks', () => {
  assert.deepEqual(examLanguagesFrom(undefined), []);
  assert.deepEqual(examLanguagesFrom(''), []);
  assert.deepEqual(examLanguagesFrom(','), []);
});

test('a repeated code counts once, where it first appears', () => {
  assert.deepEqual(examLanguagesFrom('HI,EN,HI'), [LANGUAGE_CODE.HI, LANGUAGE_CODE.EN]);
});

test('a param repeated in the URL is read as one list', () => {
  assert.deepEqual(examLanguagesFrom(['EN', 'HI,EN']), [LANGUAGE_CODE.EN, LANGUAGE_CODE.HI]);
});

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
