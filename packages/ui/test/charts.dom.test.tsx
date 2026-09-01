import assert from 'node:assert/strict';
import type { ReactElement } from 'react';
import { afterEach, describe, it } from 'node:test';
import { act, cleanup, fireEvent, render, within } from '@testing-library/react';
import { ColumnPlot } from '../src/components/charts/column-plot';
import { ComparisonCards } from '../src/components/charts/comparison-cards';
import { CompositionBar } from '../src/components/charts/composition-bar';
import { DistributionPlot } from '../src/components/charts/distribution-plot';
import { DivergingBars } from '../src/components/charts/diverging-bars';
import { LinePlot } from '../src/components/charts/line-plot';

afterEach(cleanup);

/** Recharts answers a pointer move on the next animation frame, never in the same tick. */
const nextFrame = () => new Promise<void>((resolve) => setTimeout(resolve, 32));

/** Scoped to what was rendered: Recharts measures text in a span it leaves on the body. */
function mount(ui: ReactElement) {
  const { container } = render(ui);
  const view = within(container);

  return {
    ...view,
    svg: () => container.querySelector('svg'),
    /** Recharts reads the pointer against the plot box, so a hover is a position, not an element. */
    async hover(label: string, at: { x: number; y: number }) {
      const plot = view.getByLabelText(label).parentElement as HTMLElement;
      fireEvent.mouseMove(plot, { clientX: at.x, clientY: at.y });
      await act(() => nextFrame());
      return view.getByRole('tooltip').textContent ?? '';
    },
  };
}

describe('LinePlot', () => {
  const LABEL = 'Percentile per mock';
  const POINTS = [
    { key: 'a', label: 'Mock 1', value: 55 },
    { key: 'b', label: 'Mock 2', value: 71 },
  ];

  /** Series 3–5 sit under 3:1 on the light surface, so the reading is never colour-only. */
  it('writes the latest reading beside the line', () => {
    const view = mount(<LinePlot points={POINTS} suffix="th" aria-label={LABEL} />);

    assert.ok(view.getByText('71th'));
  });

  it('answers a hover with the point under it', async () => {
    const view = mount(<LinePlot points={POINTS} suffix="th" aria-label={LABEL} />);
    assert.equal(view.queryAllByRole('tooltip').length, 0);

    const said = await view.hover(LABEL, { x: 760, y: 120 });

    assert.ok(said.includes('Mock 2'));
    assert.ok(said.includes('71th'));
  });

  /** The failure this prevents: an unranked sitting drawn on the floor as a zero. */
  it('reads an unmeasured point as a gap, never as zero', async () => {
    const view = mount(
      <LinePlot
        points={[
          { key: 'a', label: 'Mock 1', value: 55 },
          { key: 'b', label: 'Mock 2', value: null, caption: 'Not ranked' },
          { key: 'c', label: 'Mock 3', value: 71 },
        ]}
        aria-label={LABEL}
      />,
    );

    const said = await view.hover(LABEL, { x: 412, y: 120 });

    assert.ok(said.includes('Mock 2'));
    assert.ok(said.includes('—'));
    assert.ok(said.includes('Not ranked'));
    assert.ok(!said.includes('0'));
  });
});

describe('DistributionPlot', () => {
  const LABEL = 'Scores across the cohort';
  const BANDS = [
    { from: 0, to: 50, count: 12 },
    { from: 50, to: 100, count: 40, isYours: true },
  ];

  it('names the band under the pointer and how many landed in it', async () => {
    const view = mount(
      <DistributionPlot bands={BANDS} max={100} countLabel="students" aria-label={LABEL} />,
    );

    const said = await view.hover(LABEL, { x: 594, y: 120 });

    assert.ok(said.includes('50–100'));
    assert.ok(said.includes('40'));
    assert.ok(said.includes('students'));
  });

  /** Identity is never colour alone: every marker on the curve is named on it. */
  it('names each marker on the curve', () => {
    const view = mount(
      <DistributionPlot
        bands={BANDS}
        max={100}
        markers={[
          { key: 'you', label: 'You', value: 62, tone: 'you' },
          { key: 'top', label: 'Topper', value: 94, tone: 'good' },
        ]}
        aria-label={LABEL}
      />,
    );

    assert.ok(view.getByText('You'));
    assert.ok(view.getByText('Topper'));
  });

  /** The failure this prevents: a histogram nobody rolled up drawn as a measured flat one. */
  it('draws nothing at all when the cohort has no histogram yet', () => {
    const view = mount(<DistributionPlot bands={[]} max={100} aria-label={LABEL} />);

    assert.equal(view.svg(), null);
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
    const view = mount(
      <CompositionBar segments={SEGMENTS} aria-label="Where the marks came from" />,
    );

    for (const label of ['Correct', 'Wrong', 'Left blank']) {
      assert.ok(view.getByText(label));
    }
    assert.ok(view.getAllByText('+136').length >= 1);
  });

  it('answers a hover on one segment with that segment', () => {
    const view = mount(
      <CompositionBar segments={SEGMENTS} aria-label="Where the marks came from" />,
    );

    fireEvent.pointerEnter(view.getByLabelText('Wrong: −5'));

    assert.ok(view.getByRole('tooltip').textContent?.includes('Wrong'));
  });
});

describe('DivergingBars', () => {
  const LABEL = 'Sections against the cohort';
  const ITEMS = [
    { key: 'quant', label: 'Quant', value: -6, caption: 'you 32 · cohort 38' },
    { key: 'reasoning', label: 'Reasoning', value: 8 },
    { key: 'english', label: 'English', value: null },
  ];

  it('signs every bar, so the direction never rests on hue alone', () => {
    const view = mount(<DivergingBars items={ITEMS} aria-label={LABEL} />);

    assert.ok(view.getByText('−6'));
    assert.ok(view.getByText('+8'));
  });

  /** The failure this prevents: no cohort rollup drawn as "you matched the average". */
  it('draws no bar where the cohort has said nothing', () => {
    const view = mount(<DivergingBars items={ITEMS} aria-label={LABEL} />);

    assert.ok(view.getByText('—'));
    assert.equal(view.queryAllByText('+0').length, 0);
    assert.equal(view.queryAllByText('0').length, 0);
  });

  it('names both directions, so above and below never rest on hue alone', () => {
    const view = mount(
      <DivergingBars
        items={ITEMS}
        belowLabel="Below the cohort"
        aboveLabel="Above the cohort"
        aria-label={LABEL}
      />,
    );

    assert.ok(view.getByText('Below the cohort'));
    assert.ok(view.getByText('Above the cohort'));
  });

  it('carries the pair behind the difference in its hover', async () => {
    const view = mount(<DivergingBars items={ITEMS} aria-label={LABEL} />);

    const said = await view.hover(LABEL, { x: 400, y: 25 });

    assert.ok(said.includes('Quant'));
    assert.ok(said.includes('cohort 38'));
  });
});

describe('ColumnPlot', () => {
  const LABEL = 'Accuracy by difficulty';
  const COLUMNS = [
    { key: 'easy', label: 'Easy', value: 92, meta: 'n=34' },
    { key: 'hard', label: 'Hard', value: null, meta: 'n=0' },
  ];

  /** Series 3–5 sit under 3:1 on the light surface, so a value is never colour-only. */
  it('writes every value on its cap', () => {
    const view = mount(<ColumnPlot columns={COLUMNS} suffix="%" aria-label={LABEL} />);

    assert.ok(view.getByText('92%'));
    assert.ok(view.getByText('n=34'));
  });

  it('reads nothing attempted as a dash rather than nought percent', () => {
    const view = mount(<ColumnPlot columns={COLUMNS} suffix="%" aria-label={LABEL} />);

    assert.ok(view.getByText('—'));
    assert.equal(view.queryAllByText('0%').length, 0);
  });

  it('answers a hover with the value and the n behind it', async () => {
    const view = mount(<ColumnPlot columns={COLUMNS} suffix="%" aria-label={LABEL} />);

    const said = await view.hover(LABEL, { x: 224, y: 160 });

    assert.ok(said.includes('92%'));
    assert.ok(said.includes('n=34'));
  });
});

describe('ComparisonCards', () => {
  it('shows each sitting with the counts behind its bar', () => {
    const view = mount(
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

    assert.ok(view.getByText('41'));
    assert.ok(view.getByText('44'));
    assert.ok(view.getByText('21 correct · 3 wrong · 1 left · 18 min'));
  });
});
