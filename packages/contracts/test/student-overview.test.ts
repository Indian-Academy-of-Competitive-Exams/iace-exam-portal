import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  EVALUATION_MODE,
  SUBJECT_SAMPLE_FLOOR,
  TEST_SCOPE,
  measureOf,
  scopesSat,
  type SubjectStanding,
} from '../src';

describe('measureOf', () => {
  const tallies = [
    {
      scope: TEST_SCOPE.FULL,
      evaluationMode: EVALUATION_MODE.RANKED,
      attempted: 40,
      correct: 30,
      sumTimeSec: 1_600,
    },
    {
      scope: TEST_SCOPE.SECTIONAL,
      evaluationMode: EVALUATION_MODE.RANKED,
      attempted: 20,
      correct: 5,
      sumTimeSec: 1_000,
    },
    {
      scope: TEST_SCOPE.FULL,
      evaluationMode: EVALUATION_MODE.PRACTICE,
      attempted: 10,
      correct: 9,
      sumTimeSec: 200,
    },
  ];

  it('sums every scope when none is named', () => {
    const measure = measureOf(tallies, EVALUATION_MODE.RANKED);

    assert.equal(measure.attempted, 60);
    assert.equal(measure.accuracy, 58.33);
    assert.equal(measure.pace, 43.33);
  });

  it('narrows to one scope when one is named', () => {
    const measure = measureOf(tallies, EVALUATION_MODE.RANKED, TEST_SCOPE.SECTIONAL);

    assert.equal(measure.attempted, 20);
    assert.equal(measure.accuracy, 25);
  });

  /** The toggle has to move something real, or it is a control that lies. */
  it('answers the two modes with different readings', () => {
    const ranked = measureOf(tallies, EVALUATION_MODE.RANKED);
    const practice = measureOf(tallies, EVALUATION_MODE.PRACTICE);

    assert.equal(practice.accuracy, 90);
    assert.notEqual(ranked.accuracy, practice.accuracy);
    assert.notEqual(ranked.pace, practice.pace);
  });

  /** Nothing attempted is not nought per cent, which would read as every answer wrong. */
  it('reads an unattempted set as unmeasured, never as zero', () => {
    const measure = measureOf(tallies, EVALUATION_MODE.PRACTICE, TEST_SCOPE.SECTIONAL);

    assert.equal(measure.attempted, 0);
    assert.equal(measure.accuracy, null);
    assert.equal(measure.pace, null);
  });

  /** A four-question subject must never draw the same bar as a four-hundred-question one. */
  it('leaves a low sample visible in its own n', () => {
    const measure = measureOf(
      [
        {
          scope: TEST_SCOPE.SECTIONAL,
          evaluationMode: EVALUATION_MODE.RANKED,
          attempted: 4,
          correct: 4,
          sumTimeSec: 100,
        },
      ],
      EVALUATION_MODE.RANKED,
    );

    assert.equal(measure.accuracy, 100);
    assert.ok(measure.attempted < SUBJECT_SAMPLE_FLOOR);
  });
});

describe('scopesSat', () => {
  const subjects: SubjectStanding[] = [
    {
      subjectId: 'sub_r',
      name: 'Reasoning',
      tallies: [
        {
          scope: TEST_SCOPE.SECTIONAL,
          evaluationMode: EVALUATION_MODE.RANKED,
          attempted: 8,
          correct: 8,
          sumTimeSec: 80,
        },
      ],
    },
    {
      subjectId: 'sub_q',
      name: 'Quantitative Aptitude',
      tallies: [
        {
          scope: TEST_SCOPE.FULL,
          evaluationMode: EVALUATION_MODE.PRACTICE,
          attempted: 30,
          correct: 27,
          sumTimeSec: 300,
        },
      ],
    },
  ];

  /** A filter offering a scope the student has never sat narrows to an empty chart. */
  it('offers only the scopes sat in the mode being read', () => {
    assert.deepEqual(scopesSat(subjects, EVALUATION_MODE.RANKED), [TEST_SCOPE.SECTIONAL]);
    assert.deepEqual(scopesSat(subjects, EVALUATION_MODE.PRACTICE), [TEST_SCOPE.FULL]);
  });

  it('offers nothing where nothing has been folded', () => {
    assert.deepEqual(scopesSat([], EVALUATION_MODE.RANKED), []);
  });

  /** A scope with rows but nothing answered in them would open on an empty ranking. */
  it('leaves out a scope nothing was attempted in', () => {
    const untouched: SubjectStanding[] = [
      {
        subjectId: 'sub_r',
        name: 'Reasoning',
        tallies: [
          {
            scope: TEST_SCOPE.SECTIONAL,
            evaluationMode: EVALUATION_MODE.RANKED,
            attempted: 0,
            correct: 0,
            sumTimeSec: 90,
          },
        ],
      },
    ];

    assert.deepEqual(scopesSat(untouched, EVALUATION_MODE.RANKED), []);
  });
});
