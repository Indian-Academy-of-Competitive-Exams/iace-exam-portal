/** Courses narrow the exams on offer, without dropping one already on the record. */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { examsInCourses, type ExamCourse } from '../src/exams';

const EXAMS = [
  { code: 'SSC CGL', course: 'SSC' as ExamCourse },
  { code: 'SSC CHSL', course: 'SSC' as ExamCourse },
  { code: 'RRB JE', course: 'RRB' as ExamCourse },
  { code: 'IBPS PO', course: 'BANKING' as ExamCourse },
];

const codes = (courses: ExamCourse[], chosen: string[] = []): string[] =>
  examsInCourses(EXAMS, courses, chosen).map((exam) => exam.code);

describe('examsInCourses', () => {
  it('offers everything while no course is chosen', () => {
    assert.deepEqual(codes([]), ['SSC CGL', 'SSC CHSL', 'RRB JE', 'IBPS PO']);
  });

  it('narrows to the chosen course', () => {
    assert.deepEqual(codes(['SSC']), ['SSC CGL', 'SSC CHSL']);
  });

  it('adds up across several courses rather than intersecting them', () => {
    assert.deepEqual(codes(['SSC', 'RRB']), ['SSC CGL', 'SSC CHSL', 'RRB JE']);
  });

  it('keeps an exam already on the record even once its course is taken off', () => {
    assert.deepEqual(codes(['RRB'], ['SSC CGL']), ['SSC CGL', 'RRB JE']);
  });

  it('keeps the order the exams arrived in, so the list does not reshuffle as courses change', () => {
    assert.deepEqual(codes(['BANKING'], ['SSC CHSL']), ['SSC CHSL', 'IBPS PO']);
  });

  it('never invents a code that was not in the source list', () => {
    assert.deepEqual(codes(['SSC'], ['NOT AN EXAM']), ['SSC CGL', 'SSC CHSL']);
  });
});
