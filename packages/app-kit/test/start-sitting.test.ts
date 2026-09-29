import test from 'node:test';
import assert from 'node:assert/strict';
import { LANGUAGE_CODE, LANGUAGE_MODE, type LanguageCode } from '@iace/contracts';
import { beginChoice } from '../src/exam/start-sitting';

const { EN, HI } = LANGUAGE_CODE;
const single = (languages: LanguageCode[]) => ({ languageMode: LANGUAGE_MODE.SINGLE, languages });

test('a paper in one language arrives chosen, and begins in it once declared', () => {
  const choice = beginChoice(single([EN]), '', true);
  assert.equal(choice.ready, true);
  assert.deepEqual(choice.languages, [EN]);
});

/** The failure this prevents: a paper started in a language nobody picked. */
test('a paper in two languages waits for a pick, then begins in that one only', () => {
  assert.equal(beginChoice(single([EN, HI]), '', true).ready, false);
  const picked = beginChoice(single([EN, HI]), HI, true);
  assert.equal(picked.ready, true);
  assert.deepEqual(picked.languages, [HI]);
});

test('a dual paper has nothing to pick and begins in every language it shows', () => {
  const choice = beginChoice({ languageMode: LANGUAGE_MODE.DUAL, languages: [EN, HI] }, '', true);
  assert.equal(choice.dual, true);
  assert.equal(choice.ready, true);
  assert.deepEqual(choice.languages, [EN, HI]);
});

test('nothing begins before the declaration', () => {
  assert.equal(beginChoice(single([EN]), EN, false).ready, false);
});
