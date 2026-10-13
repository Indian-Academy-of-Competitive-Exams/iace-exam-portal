import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ANSWER_STATE, type PaletteCounts } from '@iace/contracts';
import { summaryOf } from '../src/features/exam/templates/banking/states';

const counts: PaletteCounts = {
  [ANSWER_STATE.ANSWERED]: 7,
  [ANSWER_STATE.ANSWERED_MARKED]: 2,
  [ANSWER_STATE.NOT_ANSWERED]: 3,
  [ANSWER_STATE.MARKED_REVIEW]: 4,
  [ANSWER_STATE.NOT_VISITED]: 14,
};

test('summaryOf counts an answer marked for review as answered, because it is evaluated', () => {
  assert.equal(summaryOf(counts).answered, 9);
});

test('summaryOf counts a question marked without an answer as not answered', () => {
  assert.equal(summaryOf(counts).notAnswered, 7);
});

test('summaryOf accounts for every question exactly once', () => {
  const row = summaryOf(counts);
  assert.equal(row.answered + row.notAnswered + row.notVisited, 30);
});
