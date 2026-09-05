import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { cleanup, render, within } from '@testing-library/react';
import { TooltipProvider } from '@iace/ui';
import {
  EVALUATION_MODE,
  TEST_SCOPE,
  measureOf,
  type Disposition,
  type EvaluationMode,
  type OverviewStanding,
  type SubjectStanding,
  type TestScope,
} from '@iace/contracts';
import {
  DispositionFigure,
  ModeTiles,
  SpeedAccuracyFigure,
  StandingTiles,
  SubjectStrengthFigure,
} from '../browser/overview-figures';

afterEach(cleanup);

const STANDING: OverviewStanding = {
  testsAttempted: 5,
  testsEvaluated: 4,
  practiceAttempts: 1,
  avgPercentile: 63.3,
  bestPercentile: 88.5,
  avgScore: 65,
  lastAttemptAt: '2026-08-30T09:00:00.000Z',
};

const DISPOSITION: Disposition = { correct: 200, wrong: 100, unattempted: 120 };

const tally = (
  scope: TestScope,
  mode: EvaluationMode,
  attempted: number,
  correct: number,
  sumTimeSec: number,
) => ({ scope, evaluationMode: mode, attempted, correct, sumTimeSec });

const SUBJECTS: SubjectStanding[] = [
  {
    subjectId: 'sub_r',
    name: 'Reasoning',
    tallies: [
      tally(TEST_SCOPE.FULL, EVALUATION_MODE.RANKED, 40, 30, 1_600),
      tally(TEST_SCOPE.FULL, EVALUATION_MODE.PRACTICE, 20, 4, 400),
    ],
  },
  {
    subjectId: 'sub_q',
    name: 'Quantitative Aptitude',
    tallies: [
      tally(TEST_SCOPE.FULL, EVALUATION_MODE.RANKED, 60, 30, 3_600),
      tally(TEST_SCOPE.FULL, EVALUATION_MODE.PRACTICE, 30, 27, 300),
    ],
  },
  {
    subjectId: 'sub_g',
    name: 'General Awareness',
    tallies: [tally(TEST_SCOPE.SECTIONAL, EVALUATION_MODE.RANKED, 8, 8, 80)],
  },
];

const everyTally = SUBJECTS.flatMap((subject) => subject.tallies);

/** The dashboard body as the screen composes it, so a render says what a reader would see. */
function Dashboard({ mode, scope }: Readonly<{ mode: EvaluationMode; scope: TestScope | null }>) {
  return (
    <>
      <StandingTiles standing={STANDING} />
      <ModeTiles measure={measureOf(everyTally, mode)} />
      <DispositionFigure disposition={DISPOSITION} />
      <SubjectStrengthFigure subjects={SUBJECTS} mode={mode} scope={scope} />
    </>
  );
}

/** `TruncatedText` names itself on hover, so every screen holding one sits under the provider. */
const shown = (mode: EvaluationMode, scope: TestScope | null = null) => {
  const { container } = render(
    <TooltipProvider>
      <Dashboard mode={mode} scope={scope} />
    </TooltipProvider>,
  );
  return { view: within(container), text: container.textContent ?? '' };
};

describe('the ranked and practice toggle', () => {
  it('moves the accuracy and pace tiles, which are summed per mode', () => {
    const ranked = shown(EVALUATION_MODE.RANKED);
    assert.ok(ranked.view.getByText('63%'));
    assert.ok(ranked.view.getByText('49s'));

    cleanup();

    const practice = shown(EVALUATION_MODE.PRACTICE);
    assert.ok(practice.view.getByText('62%'));
    assert.ok(practice.view.getByText('14s'));
  });

  /** Percentile has no practice meaning, so the toggle must not appear to move the standing. */
  it('leaves the ranked standing tiles exactly where they were', () => {
    const ranked = shown(EVALUATION_MODE.RANKED);
    assert.ok(ranked.view.getByText('63.3'));
    assert.ok(ranked.view.getByText('best 88.5'));

    cleanup();

    const practice = shown(EVALUATION_MODE.PRACTICE);
    assert.ok(practice.view.getByText('63.3'));
    assert.ok(practice.view.getByText('best 88.5'));
  });

  /** `StudentSubjectStat` never counted an unattempted question, so the donut has no per-mode source. */
  it('leaves the lifetime disposition alone, and says it is lifetime', () => {
    const ranked = shown(EVALUATION_MODE.RANKED);
    assert.ok(ranked.view.getByText('across every sitting, ranked and practice', { exact: false }));
    assert.ok(ranked.view.getByText('120'));

    cleanup();

    const practice = shown(EVALUATION_MODE.PRACTICE);
    assert.ok(practice.view.getByText('120'));
  });

  it('re-ranks the subjects from that mode alone', () => {
    const ranked = shown(EVALUATION_MODE.RANKED);
    assert.ok(
      ranked.text.indexOf('General Awareness') < ranked.text.indexOf('Reasoning'),
      'the strongest ranked subject leads',
    );

    cleanup();

    const practice = shown(EVALUATION_MODE.PRACTICE);
    assert.ok(
      practice.text.indexOf('Quantitative Aptitude') < practice.text.indexOf('Reasoning'),
      'the strongest practice subject leads',
    );
    assert.ok(!practice.text.includes('General Awareness'), 'a subject with no practice is absent');
  });
});

describe('SubjectStrengthFigure', () => {
  /** A four-question subject reading 100% must never be read without the four. */
  it('writes the n beside every accuracy, low sample included', () => {
    const { view } = shown(EVALUATION_MODE.RANKED);

    assert.ok(view.getByText('of 8'));
    assert.ok(view.getByText('of 40'));
    assert.ok(view.getByText('of 60'));
  });

  it('narrows to the scope chosen, and sums every scope when none is', () => {
    const every = shown(EVALUATION_MODE.RANKED);
    assert.equal(every.text.includes('Quantitative Aptitude'), true);
    assert.ok(every.view.getByText('3 subjects'));

    cleanup();

    const sectional = shown(EVALUATION_MODE.RANKED, TEST_SCOPE.SECTIONAL);
    assert.ok(sectional.view.getByText('1 subject'));
    assert.equal(sectional.text.includes('Quantitative Aptitude'), false);
  });

  it('says nothing was measured rather than drawing an empty ranking', () => {
    const { view } = shown(EVALUATION_MODE.PRACTICE, TEST_SCOPE.MODULE);

    assert.ok(view.getByText('No question in this mode and scope has been marked yet.'));
  });
});

describe('SpeedAccuracyFigure', () => {
  it('names all four quadrants, so a dot is never read on position alone', () => {
    const { container } = render(
      <SpeedAccuracyFigure subjects={SUBJECTS} mode={EVALUATION_MODE.RANKED} scope={null} />,
    );
    const view = within(container);

    assert.ok(view.getByText('Fast and accurate'));
    assert.ok(view.getByText('Slow and accurate'));
    assert.ok(view.getByText('Fast and inaccurate'));
    assert.ok(view.getByText('Slow and inaccurate'));
  });

  /** Nothing measured is not one subject, and saying so would invent a subject that is not there. */
  it('says nothing was measured when nothing was, rather than claiming one subject', () => {
    const { container } = render(
      <SpeedAccuracyFigure
        subjects={SUBJECTS}
        mode={EVALUATION_MODE.PRACTICE}
        scope={TEST_SCOPE.MODULE}
      />,
    );
    const view = within(container);

    assert.ok(view.getByText('No question in this mode and scope has been marked yet.'));
    assert.equal(view.queryByText(/no median to sit against/), null);
  });

  /** One dot has no median to sit against, so the quadrants would be meaningless furniture. */
  it('refuses to draw quadrants around a single subject', () => {
    const { container } = render(
      <SpeedAccuracyFigure
        subjects={SUBJECTS}
        mode={EVALUATION_MODE.RANKED}
        scope={TEST_SCOPE.SECTIONAL}
      />,
    );
    const view = within(container);

    assert.equal(view.queryByText('Fast and accurate'), null);
    assert.ok(view.getByText('One subject has no median to sit against. Sit a wider paper.'));
  });
});
