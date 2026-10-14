import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { type PerformancePoint, type SectionalStanding } from '@iace/contracts';
import {
  clock,
  isRetake,
  marksOf,
  perMinute,
  timeBenchmark,
  timeSegments,
} from '../src/report-copy';

const point = (over: Partial<PerformancePoint>) =>
  ({ isGraded: true, maxMarks: 100, score: 40, ...over }) as PerformancePoint;
const section = (over: Partial<SectionalStanding>) => over as SectionalStanding;

describe('report copy', () => {
  it('calls an unranked marked paper a retake, and a markless one nothing', () => {
    assert.equal(isRetake(point({ isGraded: false })), true);
    assert.equal(isRetake(point({ isGraded: true })), false);
    assert.equal(isRetake(point({ isGraded: false, maxMarks: 0 })), false);
  });

  it('says no marks for a typing-only paper', () => {
    assert.equal(marksOf(point({})), '40 of 100 marks');
    assert.equal(marksOf(point({ maxMarks: 0 })), undefined);
  });

  it('refuses a rate over no time', () => {
    assert.equal(perMinute(10, 120), '5.00');
    assert.equal(perMinute(10, 0), '—');
    assert.equal(perMinute(null, 60), '—');
  });

  it('flips the clock to minutes at 60', () => {
    assert.deepEqual([clock(59), clock(120)], ['59s', '2m']);
  });

  it('stands the time benchmark down when a section is unmeasured', () => {
    assert.equal(timeBenchmark([section({ topperTimeSec: null })]), undefined);
    assert.deepEqual(
      timeBenchmark([
        section({ topperTimeSec: 10, cohortAverageTimeSec: 20 }),
        section({ topperTimeSec: 5, cohortAverageTimeSec: null }),
      ]),
      { average: null, topper: 15 },
    );
  });

  it('adds Unscored only when time is left over', () => {
    const time = {
      totalSec: 100,
      avgPerQuestionSec: 5,
      avgOnCorrectSec: 10,
      avgOnWrongSec: 5,
      spentOnUnattemptedSec: 10,
    };
    const counts = { correct: 3, wrong: 2, unattempted: 1 };
    assert.deepEqual(
      timeSegments(time, counts).map((s) => s.seconds),
      [30, 10, 10, 50],
    );
    assert.equal(timeSegments({ ...time, totalSec: 40 }, counts).length, 3);
  });
});
