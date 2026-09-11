import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { cleanup, render, within } from '@testing-library/react';
import { TooltipProvider } from '@iace/ui';
import {
  TEST_SCOPE,
  measureOf,
  type Disposition,
  type SubjectStanding,
  type TestScope,
} from '@iace/contracts';
import {
  DispositionFigure,
  ModeTiles,
  SpeedAccuracyFigure,
  SubjectStrengthFigure,
} from '../browser/overview-figures';

afterEach(cleanup);

const DISPOSITION: Disposition = { correct: 200, wrong: 100, unattempted: 120 };

const tally = (scope: TestScope, attempted: number, correct: number, sumTimeSec: number) => ({
  scope,
  attempted,
  correct,
  sumTimeSec,
});

const SUBJECTS: SubjectStanding[] = [
  {
    subjectId: 'sub_r',
    name: 'Reasoning',
    tallies: [tally(TEST_SCOPE.FULL, 40, 30, 1_600)],
  },
  {
    subjectId: 'sub_q',
    name: 'Quantitative Aptitude',
    tallies: [tally(TEST_SCOPE.FULL, 60, 30, 3_600)],
  },
  {
    subjectId: 'sub_g',
    name: 'General Awareness',
    tallies: [tally(TEST_SCOPE.SECTIONAL, 8, 8, 80)],
  },
];

const everyTally = SUBJECTS.flatMap((subject) => subject.tallies);

/** The dashboard body as the screen composes it, so a render says what a reader would see. */
function Dashboard({ scope }: Readonly<{ scope: TestScope | null }>) {
  return (
    <>
      <ModeTiles measure={measureOf(everyTally)} />
      <DispositionFigure disposition={DISPOSITION} />
      <SubjectStrengthFigure subjects={SUBJECTS} scope={scope} />
    </>
  );
}

/** `TruncatedText` names itself on hover, so every screen holding one sits under the provider. */
const shown = (scope: TestScope | null = null) => {
  const { container } = render(
    <TooltipProvider>
      <Dashboard scope={scope} />
    </TooltipProvider>,
  );
  return { view: within(container), text: container.textContent ?? '' };
};

describe('SubjectStrengthFigure', () => {
  /** A four-question subject reading 100% must never be read without the four. */
  it('writes the n beside every accuracy, low sample included', () => {
    const { view } = shown();

    assert.ok(view.getByText('of 8'));
    assert.ok(view.getByText('of 40'));
    assert.ok(view.getByText('of 60'));
  });

  it('narrows to the scope chosen, and sums every scope when none is', () => {
    const every = shown();
    assert.equal(every.text.includes('Quantitative Aptitude'), true);
    assert.ok(every.view.getByText('3 subjects'));

    cleanup();

    const sectional = shown(TEST_SCOPE.SECTIONAL);
    assert.ok(sectional.view.getByText('1 subject'));
    assert.equal(sectional.text.includes('Quantitative Aptitude'), false);
  });

  it('says nothing was measured rather than drawing an empty ranking', () => {
    const { view } = shown(TEST_SCOPE.MODULE);

    assert.ok(view.getByText('No question in this scope has been marked yet.'));
  });
});

describe('SpeedAccuracyFigure', () => {
  it('names all four quadrants, so a dot is never read on position alone', () => {
    const { container } = render(<SpeedAccuracyFigure subjects={SUBJECTS} scope={null} />);
    const view = within(container);

    assert.ok(view.getByText('Fast and accurate'));
    assert.ok(view.getByText('Slow and accurate'));
    assert.ok(view.getByText('Fast and inaccurate'));
    assert.ok(view.getByText('Slow and inaccurate'));
  });

  /** Nothing measured is not one subject, and saying so would invent a subject that is not there. */
  it('says nothing was measured when nothing was, rather than claiming one subject', () => {
    const { container } = render(
      <SpeedAccuracyFigure subjects={SUBJECTS} scope={TEST_SCOPE.MODULE} />,
    );
    const view = within(container);

    assert.ok(view.getByText('No question in this scope has been marked yet.'));
    assert.equal(view.queryByText(/no median to sit against/), null);
  });

  /** One dot has no median to sit against, so the quadrants would be meaningless furniture. */
  it('refuses to draw quadrants around a single subject', () => {
    const { container } = render(
      <SpeedAccuracyFigure subjects={SUBJECTS} scope={TEST_SCOPE.SECTIONAL} />,
    );
    const view = within(container);

    assert.equal(view.queryByText('Fast and accurate'), null);
    assert.ok(view.getByText('One subject has no median to sit against. Sit a wider paper.'));
  });
});
