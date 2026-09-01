import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { cleanup, render, screen, within } from '@testing-library/react';
import {
  type CohortCurve,
  type DifficultyStanding,
  type PercentilePoint,
  type SectionalStanding,
} from '@iace/contracts';
import {
  CohortFigure,
  DifficultyFigure,
  SectionsFigure,
  TimeFigure,
  TrajectoryFigure,
} from '../browser/performance-figures';

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
    const { container } = render(
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

    const view = within(container);
    assert.ok(view.getByText('—'));
    assert.equal(view.queryAllByText('0%').length, 0);
    assert.ok(view.getByText('80%'));
  });

  it('names a band by the level it carries', () => {
    const { container } = render(
      <DifficultyFigure difficulty={[band({ key: 'MEDIUM', name: 'MEDIUM' })]} />,
    );

    assert.ok(within(container).getByText('Medium'));
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
    const { container } = render(
      <TrajectoryFigure
        trajectory={[
          point({ attemptId: 'a1', testTitle: 'Mock 1', percentile: 55 }),
          point({ attemptId: 'a2', testTitle: 'Mock 2', percentile: 71 }),
          point({ attemptId: 'a3', testTitle: 'Mock 3', percentile: null }),
        ]}
      />,
    );

    assert.ok(within(container).getAllByText('71').length > 0);
    assert.equal(container.querySelectorAll('circle').length, 2);
  });

  it('reads a trajectory nothing measured as unmeasured, never as zero', () => {
    const { container } = render(
      <TrajectoryFigure trajectory={[point({ testTitle: 'Mock 1', percentile: null })]} />,
    );

    assert.ok(within(container).getAllByText('\u2014').length > 0);
    assert.equal(container.querySelectorAll('circle').length, 0);
  });
});

describe('TimeFigure', () => {
  const clock = {
    totalSec: 1800,
    avgPerQuestionSec: 60,
    avgOnCorrectSec: 50,
    avgOnWrongSec: 70,
    spentOnUnattemptedSec: 120,
  };
  const counts = { correct: 12, wrong: 6, unattempted: 12, total: 30 };

  /** Above one is slower than the field; the unit says which, so the number needs no sentence. */
  it('names the pace against the cohort where the rollup has one', () => {
    render(<TimeFigure time={clock} counts={counts} paceIndex={1.4} />);

    assert.ok(screen.getByText('Pace'));
    assert.ok(screen.getByText('slower'));
  });

  it('reads a faster paper as faster', () => {
    render(<TimeFigure time={clock} counts={counts} paceIndex={0.8} />);

    assert.ok(screen.getByText('faster'));
  });

  /** No cohort has been counted, so there is no pace to state — and none is stated. */
  it('leaves the pace out where no cohort has been counted', () => {
    render(<TimeFigure time={clock} counts={counts} paceIndex={null} />);

    assert.ok(screen.getByText('Total'));
    assert.equal(screen.queryByText('Pace'), null);
  });
});

describe('SectionsFigure', () => {
  const section = (over: Partial<SectionalStanding> = {}): SectionalStanding => ({
    baseConfigSectionId: 'sec_1',
    name: 'Reasoning',
    order: 1,
    questionCount: 25,
    maxMarks: 50,
    score: 32,
    correctCount: 16,
    wrongCount: 4,
    unattemptedCount: 5,
    timeSpentSec: 600,
    cohortAverageScore: 28,
    cohortAverageTimeSec: 660,
    cohortSampleSize: 40,
    topperTimeSec: 480,
    ...over,
  });

  /** No rollup has counted this paper, so the two comparison clocks are absent, not zero. */
  it('says nothing about a cohort nothing has counted', () => {
    const { container } = render(
      <SectionsFigure
        sections={[
          section({
            cohortAverageScore: null,
            cohortAverageTimeSec: null,
            cohortSampleSize: 0,
            topperTimeSec: null,
          }),
        ]}
      />,
    );

    assert.doesNotMatch(container.textContent ?? '', /cohort \d/);
    assert.doesNotMatch(container.textContent ?? '', /topper \d/);
  });
});
