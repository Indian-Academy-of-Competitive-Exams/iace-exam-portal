import test from 'node:test';
import assert from 'node:assert/strict';
import { LANGUAGE_CODE } from '@iace/contracts';
import { examLanguagesFrom } from '../src/lib/exam-routes';

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
