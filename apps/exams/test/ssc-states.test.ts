import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ANSWER_STATE, type PaletteCounts } from '@iace/contracts';
import { answeredOf, summaryOf } from '../src/features/exam/templates/ssc/states';

const counts: PaletteCounts = {
  [ANSWER_STATE.ANSWERED]: 7,
  [ANSWER_STATE.ANSWERED_MARKED]: 2,
  [ANSWER_STATE.NOT_ANSWERED]: 3,
  [ANSWER_STATE.MARKED_REVIEW]: 4,
  [ANSWER_STATE.NOT_VISITED]: 9,
};

test('answeredOf counts an answer marked for review, because it is evaluated', () => {
  assert.equal(answeredOf(counts), 9);
});

test('summaryOf puts both kinds of mark under one heading', () => {
  assert.equal(summaryOf(counts).marked, 6);
});

test('summaryOf accounts for every question exactly once', () => {
  const row = summaryOf(counts);
  assert.equal(row.answered + row.notAnswered + row.marked + row.notVisited, 25);
});
