import test from 'node:test';
import assert from 'node:assert/strict';
import { LANGUAGE_CODE, LANGUAGE_MODE, QUESTION_TYPE, type ExamQuestion } from '@iace/contracts';
import { preloadHtmlOf } from '../src/components/exam/question-protocol';

const node = (text: string) => [{ type: 'TEXT' as const, text }];

const questionWith = (
  id: string,
  stemEn: string,
  stemHi: string,
  optionText: string,
): ExamQuestion => ({
  questionId: id,
  order: 1,
  baseConfigSectionId: 's1',
  type: QUESTION_TYPE.SINGLE_MCQ,
  marks: 2,
  negativeMarks: 0.5,
  content: {
    en: { stem: node(stemEn) },
    hi: { stem: node(stemHi) },
  },
  options: [
    { id: `${id}-a`, position: 0, text: { en: node(optionText), hi: node(`${optionText}-hi`) } },
    { id: `${id}-b`, position: 1, text: { en: node('2'), hi: node('दो') } },
  ],
});

const q1 = questionWith('q1', '<p>Stem one</p>', '<p>स्टेम एक</p>', 'Option A');
const q2 = questionWith('q2', '<p>Stem two</p>', '<p>स्टेम दो</p>', 'Option A');

test('every question stem and its options are included, in the shown languages', () => {
  const html = preloadHtmlOf([q1], [LANGUAGE_CODE.EN], LANGUAGE_MODE.SINGLE);
  assert.ok(html.includes('<p>Stem one</p>'));
  assert.ok(html.includes('Option A'));
  assert.ok(html.includes('2'));
});

test('SINGLE includes only the first shown language; DUAL includes both', () => {
  const single = preloadHtmlOf([q1], [LANGUAGE_CODE.EN, LANGUAGE_CODE.HI], LANGUAGE_MODE.SINGLE);
  assert.ok(single.includes('<p>Stem one</p>'));
  assert.ok(!single.includes('<p>स्टेम एक</p>'));

  const dual = preloadHtmlOf([q1], [LANGUAGE_CODE.EN, LANGUAGE_CODE.HI], LANGUAGE_MODE.DUAL);
  assert.ok(dual.includes('<p>Stem one</p>'));
  assert.ok(dual.includes('<p>स्टेम एक</p>'));
});

test('identical HTML strings are deduped', () => {
  const html = preloadHtmlOf([q1, q2], [LANGUAGE_CODE.EN], LANGUAGE_MODE.SINGLE);
  assert.equal(html.filter((entry) => entry === 'Option A').length, 1);
});

test('an empty paper gives an empty list', () => {
  assert.deepEqual(preloadHtmlOf([], [LANGUAGE_CODE.EN], LANGUAGE_MODE.SINGLE), []);
});
