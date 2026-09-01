import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { cleanup, render, screen } from '@testing-library/react';
import { type CohortCurve, type DifficultyStanding, type PercentilePoint } from '@iace/contracts';
import { CohortFigure, DifficultyFigure, TrajectoryFigure } from '../browser/performance-figures';

afterEach(cleanup);

const band = (over: Partial<DifficultyStanding>): DifficultyStanding => ({
  key: 'LOW',
  name: 'LOW',
  total: 10,
  attempted: 10,
  correct: 8,
  wrong: 2,
  unattempted: 0,
  accuracy: 80,
  marks: 8,
  timeSpentSec: 300,
  cohortPValue: null,
  cohortQuestionCount: 0,
  ...over,
});

const point = (over: Partial<PercentilePoint>): PercentilePoint => ({
  attemptId: 'a1',
  testId: 't1',
  testTitle: 'Mock 1',
  submittedAt: null,
  percentile: 55,
  rank: null,
  cohortSize: null,
  ...over,
});

const curve = (over: Partial<CohortCurve>): CohortCurve => ({
  testId: 't1',
  score: 40,
  topperScore: null,
  averageScore: null,
  rank: 3,
  percentile: 70,
  cohortSize: 4,
  bands: [
    { from: 0, to: 25, count: 1, isYours: false },
    { from: 25, to: 50, count: 3, isYours: true },
  ],
  ...over,
});

describe('DifficultyFigure', () => {
  /** The failure this prevents: a band nobody touched drawn as a 0% they scored. */
  it('reads a band with nothing attempted as unmeasured, never as zero', () => {
    render(
      <DifficultyFigure
        difficulty={[
          band({ key: 'LOW', name: 'LOW', accuracy: 80 }),
          band({
            key: 'HIGH',
            name: 'HIGH',
            accuracy: null,
            attempted: 0,
            correct: 0,
            wrong: 0,
            unattempted: 6,
            total: 6,
          }),
        ]}
      />,
    );

    assert.ok(screen.getByLabelText('High: —'));
    assert.equal(screen.queryByLabelText('High: 0%'), null);
    assert.ok(screen.getByLabelText('Low: 80%'));
  });

  it('names a band by the level it carries', () => {
    render(<DifficultyFigure difficulty={[band({ key: 'MEDIUM', name: 'MEDIUM' })]} />);

    assert.ok(screen.getByLabelText('Medium: 80%'));
  });
});

describe('CohortFigure', () => {
  /** A withheld topper or average is absent, not a marker parked on zero marks. */
  it('draws no marker for a cohort figure the report withheld', () => {
    render(<CohortFigure cohort={curve({})} youLabel="This student" />);

    assert.ok(screen.getByText('This student'));
    assert.equal(screen.queryByText('Topper'), null);
    assert.equal(screen.queryByText('Average'), null);
  });

  it('draws the topper and the average once the report carries them', () => {
    render(<CohortFigure cohort={curve({ topperScore: 48, averageScore: 30 })} />);

    assert.ok(screen.getByText('You'));
    assert.ok(screen.getByText('Topper'));
    assert.ok(screen.getByText('Average'));
  });
});

describe('TrajectoryFigure', () => {
  /** An unranked latest sitting must not blank the headline the whole figure is read for. */
  it('headlines the latest MEASURED percentile', () => {
    render(
      <TrajectoryFigure
        trajectory={[
          point({ attemptId: 'a1', testTitle: 'Mock 1', percentile: 55 }),
          point({ attemptId: 'a2', testTitle: 'Mock 2', percentile: 71 }),
          point({ attemptId: 'a3', testTitle: 'Mock 3', percentile: null }),
        ]}
      />,
    );

    assert.ok(screen.getAllByText('71').length > 0);
    assert.ok(screen.getByLabelText('Mock 3: \u2014'));
    assert.equal(screen.queryByLabelText('Mock 3: 0'), null);
  });

  it('reads a trajectory nothing measured as unmeasured, never as zero', () => {
    render(<TrajectoryFigure trajectory={[point({ testTitle: 'Mock 1', percentile: null })]} />);

    assert.ok(screen.getAllByText('\u2014').length > 0);
    assert.equal(screen.queryByLabelText('Mock 1: 0'), null);
  });
});
