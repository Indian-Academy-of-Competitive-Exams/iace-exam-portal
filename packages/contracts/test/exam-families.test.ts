/** Families narrow the exams on offer, without dropping one already on the record. */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { examsInFamilies, type ExamFamily } from '../src/exams';

const EXAMS = [
  { code: 'SSC CGL', family: 'SSC' as ExamFamily },
  { code: 'SSC CHSL', family: 'SSC' as ExamFamily },
  { code: 'RRB JE', family: 'RRB' as ExamFamily },
  { code: 'IBPS PO', family: 'BANKING' as ExamFamily },
];

const codes = (families: ExamFamily[], chosen: string[] = []): string[] =>
  examsInFamilies(EXAMS, families, chosen).map((exam) => exam.code);

describe('examsInFamilies', () => {
  it('offers everything while no family is chosen', () => {
    assert.deepEqual(codes([]), ['SSC CGL', 'SSC CHSL', 'RRB JE', 'IBPS PO']);
  });

  it('narrows to the chosen family', () => {
    assert.deepEqual(codes(['SSC']), ['SSC CGL', 'SSC CHSL']);
  });

  it('adds up across several families rather than intersecting them', () => {
    assert.deepEqual(codes(['SSC', 'RRB']), ['SSC CGL', 'SSC CHSL', 'RRB JE']);
  });

  it('keeps an exam already on the record even once its family is taken off', () => {
    assert.deepEqual(codes(['RRB'], ['SSC CGL']), ['SSC CGL', 'RRB JE']);
  });

  it('keeps the order the exams arrived in, so the list does not reshuffle as families change', () => {
    assert.deepEqual(codes(['BANKING'], ['SSC CHSL']), ['SSC CHSL', 'IBPS PO']);
  });

  it('never invents a code that was not in the source list', () => {
    assert.deepEqual(codes(['SSC'], ['NOT AN EXAM']), ['SSC CGL', 'SSC CHSL']);
  });
});
