/** Families narrow the exams on offer, without dropping one already on the record. */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { examsInFamilies, type ExamFamily } from '../src/exams';

const EXAMS = [
  { code: 'SSC_CGL', family: 'SSC' as ExamFamily },
  { code: 'SSC_CHSL', family: 'SSC' as ExamFamily },
  { code: 'RRB_JE', family: 'RRB' as ExamFamily },
  { code: 'IBPS_PO', family: 'BANKING' as ExamFamily },
];

const codes = (families: ExamFamily[], chosen: string[] = []): string[] =>
  examsInFamilies(EXAMS, families, chosen).map((exam) => exam.code);

describe('examsInFamilies', () => {
  it('offers everything while no family is chosen', () => {
    assert.deepEqual(codes([]), ['SSC_CGL', 'SSC_CHSL', 'RRB_JE', 'IBPS_PO']);
  });

  it('narrows to the chosen family', () => {
    assert.deepEqual(codes(['SSC']), ['SSC_CGL', 'SSC_CHSL']);
  });

  it('adds up across several families rather than intersecting them', () => {
    assert.deepEqual(codes(['SSC', 'RRB']), ['SSC_CGL', 'SSC_CHSL', 'RRB_JE']);
  });

  it('keeps an exam already on the record even once its family is taken off', () => {
    assert.deepEqual(codes(['RRB'], ['SSC_CGL']), ['SSC_CGL', 'RRB_JE']);
  });

  it('keeps the order the exams arrived in, so the list does not reshuffle as families change', () => {
    assert.deepEqual(codes(['BANKING'], ['SSC_CHSL']), ['SSC_CHSL', 'IBPS_PO']);
  });

  it('never invents a code that was not in the source list', () => {
    assert.deepEqual(codes(['SSC'], ['NOT_AN_EXAM']), ['SSC_CGL', 'SSC_CHSL']);
  });
});
