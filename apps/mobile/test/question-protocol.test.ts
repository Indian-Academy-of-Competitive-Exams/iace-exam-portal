import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EXAM_TEMPLATE,
  LANGUAGE_CODE,
  LANGUAGE_MODE,
  OMR_FILL,
  QUESTION_TYPE,
  TEST_UI,
  type ExamQuestion,
  type TestUi,
} from '@iace/contracts';
import { PAGE_MESSAGE } from '../src/components/exam/question-bridge';
import { questionScreen, readPageMessage } from '../src/components/exam/question-protocol';

const node = (text: string) => [{ type: 'TEXT' as const, text }];

const question: ExamQuestion = {
  questionId: 'q1',
  order: 1,
  baseConfigSectionId: 's1',
  type: QUESTION_TYPE.SINGLE_MCQ,
  marks: 2,
  negativeMarks: 0.5,
  content: {
    en: { stem: node('<p>Solve for x</p>') },
    hi: { stem: node('<p>x का मान ज्ञात करें</p>') },
  },
  options: [
    { id: 'o1', position: 0, text: { en: node('1'), hi: node('एक') } },
    { id: 'o2', position: 1, text: { en: node('2'), hi: node('दो') } },
  ],
};

const screenFor = (testUi: TestUi, selectedOptionId: string | null = null, marked = false) =>
  questionScreen({
    question,
    languages: [LANGUAGE_CODE.EN, LANGUAGE_CODE.HI],
    languageMode: LANGUAGE_MODE.SINGLE,
    testUi,
    examTemplate: EXAM_TEMPLATE.DEFAULT,
    selectedOptionId,
    marked,
  });

const cbt = screenFor(TEST_UI.CBT);
const omr = screenFor(TEST_UI.OMR);

test('a tap on an option decodes to choosing it', () => {
  assert.deepEqual(readPageMessage('{"type":"CHOOSE","optionId":"o2"}', cbt), {
    type: PAGE_MESSAGE.CHOOSE,
    optionId: 'o2',
  });
});

test('a held bubble decodes to its option and how far it was filled', () => {
  assert.deepEqual(readPageMessage('{"type":"BUBBLE","optionId":"o1","fill":0.42}', omr), {
    type: PAGE_MESSAGE.BUBBLE,
    optionId: 'o1',
    fill: 0.42,
  });
});

test('the page saying it loaded decodes to ready', () => {
  assert.deepEqual(readPageMessage('{"type":"READY"}', cbt), { type: PAGE_MESSAGE.READY });
});

test('a malformed message is rejected', () => {
  for (const data of ['', 'CHOOSE o1', '{"type":"CHOOSE",', 'null', '42', '["CHOOSE","o1"]']) {
    assert.equal(readPageMessage(data, cbt), null, data);
  }
});

test('an unknown message type is rejected', () => {
  for (const data of [
    '{"type":"SUBMIT"}',
    '{"type":"choose","optionId":"o1"}',
    '{"optionId":"o1"}',
  ]) {
    assert.equal(readPageMessage(data, cbt), null, data);
  }
});

test('a message missing a required field is rejected', () => {
  assert.equal(readPageMessage('{"type":"CHOOSE"}', cbt), null, 'choose without an option');
  assert.equal(readPageMessage('{"type":"BUBBLE","optionId":"o1"}', omr), null, 'no fill');
  assert.equal(readPageMessage('{"type":"BUBBLE","fill":1}', omr), null, 'no option');
});

test('a field of the wrong shape is rejected', () => {
  for (const data of [
    '{"type":"CHOOSE","optionId":7}',
    '{"type":"CHOOSE","optionId":"o1","extra":true}',
    '{"type":"BUBBLE","optionId":"o1","fill":"1"}',
    '{"type":"BUBBLE","optionId":"o1","fill":0}',
    '{"type":"BUBBLE","optionId":"o1","fill":1.5}',
  ]) {
    assert.equal(readPageMessage(data, omr) ?? readPageMessage(data, cbt), null, data);
  }
});

test('an option that is not on the question on screen is rejected', () => {
  assert.equal(readPageMessage('{"type":"CHOOSE","optionId":"from-the-last-question"}', cbt), null);
});

test('a message for the other answering mode is rejected', () => {
  assert.equal(readPageMessage('{"type":"CHOOSE","optionId":"o1"}', omr), null, 'choose on OMR');
  assert.equal(
    readPageMessage('{"type":"BUBBLE","optionId":"o1","fill":1}', cbt),
    null,
    'bubble on CBT',
  );
});

test('a bubble on a locked OMR question is rejected', () => {
  const locked = screenFor(TEST_UI.OMR, 'o1');
  assert.equal(locked.locked, true);
  assert.equal(readPageMessage('{"type":"BUBBLE","optionId":"o2","fill":1}', locked), null);
});

test('OMR inks the held option full and locks it, or half when it is flagged', () => {
  const committed = screenFor(TEST_UI.OMR, 'o1');
  assert.deepEqual(
    committed.options.map((option) => option.fill),
    [OMR_FILL.FULL, 0],
  );

  const flagged = screenFor(TEST_UI.OMR, 'o1', true);
  assert.equal(flagged.locked, false, 'a flagged question can still be re-bubbled');
  assert.deepEqual(
    flagged.options.map((option) => option.fill),
    [OMR_FILL.PARTIAL, 0],
  );

  assert.equal(screenFor(TEST_UI.CBT, 'o1').locked, false, 'CBT never locks');
});

test('SINGLE shows the first language and DUAL shows both, stem and options', () => {
  assert.deepEqual(
    cbt.stem.map((block) => block.lang),
    ['en'],
  );
  const dual = questionScreen({
    question,
    languages: [LANGUAGE_CODE.HI, LANGUAGE_CODE.EN],
    languageMode: LANGUAGE_MODE.DUAL,
    testUi: TEST_UI.CBT,
    examTemplate: EXAM_TEMPLATE.SSC_RAILWAYS,
    selectedOptionId: null,
    marked: false,
  });
  assert.deepEqual(dual.stem, [
    { lang: 'hi', html: '<p>x का मान ज्ञात करें</p>' },
    { lang: 'en', html: '<p>Solve for x</p>' },
  ]);
  assert.deepEqual(dual.options[1]?.content, [
    { lang: 'hi', html: 'दो' },
    { lang: 'en', html: '2' },
  ]);
  assert.equal(dual.template, 'ssc_railways');
});
