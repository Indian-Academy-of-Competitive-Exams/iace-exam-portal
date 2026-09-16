import test from 'node:test';
import assert from 'node:assert/strict';
import { AppException, ErrorCodes, LANGUAGE_CODE } from '@iace/contracts';
import { examLanguagesFrom, isMarkingPending } from '../src/lib/exam-routes';

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

test('a CONFLICT from the score card means marking is still queued', () => {
  assert.equal(isMarkingPending(new AppException(ErrorCodes.CONFLICT)), true);
});

test('any other failure of the score card is a real one', () => {
  assert.equal(isMarkingPending(new AppException(ErrorCodes.NOT_FOUND)), false);
  assert.equal(isMarkingPending(new AppException(ErrorCodes.INTERNAL)), false);
  assert.equal(isMarkingPending(new Error('network down')), false);
  assert.equal(isMarkingPending({ code: ErrorCodes.CONFLICT }), false, 'a look-alike is not one');
});
