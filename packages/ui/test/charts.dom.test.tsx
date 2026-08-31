import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ColumnPlot } from '../src/components/charts/column-plot';
import { ComparisonCards } from '../src/components/charts/comparison-cards';
import { CompositionBar } from '../src/components/charts/composition-bar';
import { DistributionPlot } from '../src/components/charts/distribution-plot';
import { DivergingBars } from '../src/components/charts/diverging-bars';
import { LinePlot } from '../src/components/charts/line-plot';

afterEach(cleanup);

const tooltip = () => screen.queryByRole('tooltip');

describe('LinePlot', () => {
  const POINTS = [
    { key: 'a', label: 'Mock 1', value: 55 },
    { key: 'b', label: 'Mock 2', value: 71 },
  ];

  it('answers a hover with the point under it', () => {
    render(<LinePlot points={POINTS} suffix="th" aria-label="Percentile per mock" />);
    assert.equal(tooltip(), null);

    fireEvent.pointerEnter(screen.getByLabelText('Mock 2: 71th'));

    assert.ok(tooltip());
    assert.ok(screen.getByRole('tooltip').textContent?.includes('71th'));
  });

  /** A chart a mouse can read and a keyboard cannot is half a chart. */
  it('answers a focus the same way it answers a hover', () => {
    render(<LinePlot points={POINTS} aria-label="Percentile per mock" />);

    fireEvent.focus(screen.getByLabelText('Mock 1: 55'));

    assert.ok(screen.getByRole('tooltip').textContent?.includes('55'));
  });

  /** The failure this prevents: an unranked sitting drawn on the floor as a zero. */
  it('reads an unmeasured point as a gap, never as zero', () => {
    render(
      <LinePlot
        points={[
          { key: 'a', label: 'Mock 1', value: 55 },
          { key: 'b', label: 'Mock 2', value: null, caption: 'Not ranked' },
          { key: 'c', label: 'Mock 3', value: 71 },
        ]}
        aria-label="Percentile per mock"
      />,
    );

    assert.ok(screen.getByLabelText('Mock 2: —'));
    assert.equal(screen.queryByLabelText('Mock 2: 0'), null);

    fireEvent.focus(screen.getByLabelText('Mock 2: —'));
    assert.ok(screen.getByRole('tooltip').textContent?.includes('Not ranked'));
  });
});

describe('DistributionPlot', () => {
  const BANDS = [
    { from: 0, to: 50, count: 12 },
    { from: 50, to: 100, count: 40, isYours: true },
  ];

  it('names the band under the pointer and how many landed in it', () => {
    render(
      <DistributionPlot
        bands={BANDS}
        max={100}
        countLabel="students"
        aria-label="Scores across the cohort"
      />,
    );

    fireEvent.pointerEnter(screen.getByLabelText('50–100: 40'));

    const text = screen.getByRole('tooltip').textContent ?? '';
    assert.ok(text.includes('40'));
    assert.ok(text.includes('students'));
  });

  /** The failure this prevents: a histogram nobody rolled up drawn as a measured flat one. */
  it('draws nothing at all when the cohort has no histogram yet', () => {
    const { container } = render(
      <DistributionPlot bands={[]} max={100} aria-label="Scores across the cohort" />,
    );

    assert.equal(container.querySelector('svg'), null);
  });
});

describe('CompositionBar', () => {
  const SEGMENTS = [
    { key: 'right', label: 'Correct', value: 68, display: '+136', tone: 'positive' as const },
    { key: 'wrong', label: 'Wrong', value: 10, display: '−5', tone: 'negative' as const },
    { key: 'blank', label: 'Left blank', value: 22, display: '0', tone: 'neutral' as const },
  ];

  /** A segment too thin for its own words still has to be readable without a mouse. */
  it('writes every value out beside the bar, not only inside it', () => {
    render(<CompositionBar segments={SEGMENTS} aria-label="Where the marks came from" />);

    for (const label of ['Correct', 'Wrong', 'Left blank']) {
      assert.ok(screen.getByText(label));
    }
    assert.ok(screen.getAllByText('+136').length >= 1);
  });

  it('answers a hover on one segment with that segment', () => {
    render(<CompositionBar segments={SEGMENTS} aria-label="Where the marks came from" />);

    fireEvent.pointerEnter(screen.getByLabelText('Wrong: −5'));

    assert.ok(screen.getByRole('tooltip').textContent?.includes('Wrong'));
  });
});

describe('DivergingBars', () => {
  const ITEMS = [
    { key: 'quant', label: 'Quant', value: -6, caption: 'you 32 · cohort 38' },
    { key: 'reasoning', label: 'Reasoning', value: 8 },
    { key: 'english', label: 'English', value: null },
  ];

  it('signs every bar, so the direction never rests on hue alone', () => {
    render(<DivergingBars items={ITEMS} aria-label="Sections against the cohort" />);

    assert.ok(screen.getByText('−6'));
    assert.ok(screen.getByText('+8'));
  });

  /** The failure this prevents: no cohort rollup drawn as "you matched the average". */
  it('draws no bar where the cohort has said nothing', () => {
    render(<DivergingBars items={ITEMS} aria-label="Sections against the cohort" />);

    assert.ok(screen.getByLabelText('English: —'));
    assert.equal(screen.queryByLabelText('English: +0'), null);
  });

  it('carries the pair behind the difference in its hover', () => {
    render(<DivergingBars items={ITEMS} aria-label="Sections against the cohort" />);

    fireEvent.pointerEnter(screen.getByLabelText('Quant: −6'));

    assert.ok(screen.getByRole('tooltip').textContent?.includes('cohort 38'));
  });
});

describe('ColumnPlot', () => {
  const COLUMNS = [
    { key: 'easy', label: 'Easy', value: 92, meta: 'n=34' },
    { key: 'hard', label: 'Hard', value: null, meta: 'n=0' },
  ];

  /** Series 3–5 sit under 3:1 on the light surface, so a value is never colour-only. */
  it('writes every value on its cap', () => {
    render(<ColumnPlot columns={COLUMNS} suffix="%" aria-label="Accuracy by difficulty" />);

    assert.ok(screen.getByText('92%'));
    assert.ok(screen.getByText('n=34'));
  });

  it('reads nothing attempted as a dash rather than nought percent', () => {
    render(<ColumnPlot columns={COLUMNS} suffix="%" aria-label="Accuracy by difficulty" />);

    assert.ok(screen.getByLabelText('Hard: —'));
    assert.equal(screen.queryByLabelText('Hard: 0%'), null);
  });

  it('answers a hover with the value and the n behind it', () => {
    render(<ColumnPlot columns={COLUMNS} suffix="%" aria-label="Accuracy by difficulty" />);

    fireEvent.pointerEnter(screen.getByLabelText('Easy: 92%'));

    const text = screen.getByRole('tooltip').textContent ?? '';
    assert.ok(text.includes('92%'));
    assert.ok(text.includes('n=34'));
  });
});

describe('ComparisonCards', () => {
  it('shows each sitting with the counts behind its bar', () => {
    render(
      <ComparisonCards
        items={[
          {
            key: 'now',
            label: 'This attempt',
            value: 41,
            max: 50,
            tone: 'current',
            caption: '21 correct · 3 wrong · 1 left · 18 min',
            segments: [
              { key: 'right', label: 'Correct', value: 21, tone: 'positive' },
              { key: 'wrong', label: 'Wrong', value: 3, tone: 'negative' },
            ],
          },
          {
            key: 'best',
            label: 'Your best',
            value: 44,
            max: 50,
            caption: '23 correct · 2 wrong · 0 left · 19 min',
            segments: [
              { key: 'right', label: 'Correct', value: 23, tone: 'positive' },
              { key: 'wrong', label: 'Wrong', value: 2, tone: 'negative' },
            ],
          },
        ]}
      />,
    );

    assert.ok(screen.getByText('41'));
    assert.ok(screen.getByText('44'));
    assert.ok(screen.getByText('21 correct · 3 wrong · 1 left · 18 min'));
  });
});
