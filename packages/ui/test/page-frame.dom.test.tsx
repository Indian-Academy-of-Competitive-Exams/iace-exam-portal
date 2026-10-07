import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { PageFrame, PanelFrame, SplitFrame, TableFrame } from '../src/components/ui/table-frame';
import { TooltipProvider } from '../src/components/ui/tooltip';

afterEach(cleanup);

describe('PageFrame', () => {
  /** The shell only stops scrolling the whole page when it :has() this attribute. */
  it('marks itself as the page frame', () => {
    const { container } = render(
      <PageFrame header={<h1>Students</h1>}>
        <p>body</p>
      </PageFrame>,
    );

    assert.ok(container.querySelector('[data-page-frame]'));
  });

  /** The failure this prevents: the header inside the scroller is a header that scrolls away. */
  it('keeps the header out of the scrolling body', () => {
    render(
      <PageFrame header={<h1>Students</h1>}>
        <p>body</p>
      </PageFrame>,
    );

    const scroller = screen.getByText('body').parentElement;
    assert.ok(scroller?.className.includes('overflow-y-auto'));
    assert.equal(scroller?.contains(screen.getByRole('heading', { name: 'Students' })), false);
  });

  /** A flex child defaults to min-height:auto and hands the scroll straight back to the page. */
  it('lets the body shrink below its content', () => {
    render(
      <PageFrame header={<h1>Students</h1>}>
        <p>body</p>
      </PageFrame>,
    );

    assert.ok(screen.getByText('body').parentElement?.className.includes('min-h-0'));
  });

  it('renders without a header at all', () => {
    render(
      <PageFrame>
        <p>body</p>
      </PageFrame>,
    );

    assert.ok(screen.getByText('body'));
  });
});

describe('PanelFrame', () => {
  const tabs = {
    value: 'marks',
    onValueChange: () => undefined,
    items: [
      { value: 'marks', label: 'Score card', content: <p>What they scored</p> },
      { value: 'compare', label: 'Compare', content: <p>Who else sat it</p> },
    ],
  };

  /** A list frame scrolls its table; this one has no table, so the card's body scrolls instead. */
  it('makes its own body the scroller, since nothing inside it is a table', () => {
    const { container } = render(
      <PanelFrame header={<h1>Report</h1>}>
        <p>A stack of figures</p>
      </PanelFrame>,
    );

    const scrollers = container.querySelectorAll('.overflow-y-auto');
    assert.equal(scrollers.length, 1);
    assert.ok(scrollers[0]?.className.includes('min-h-0'));
    // Absolutely positioned children resolve against it rather than escaping to the document.
    assert.ok(scrollers[0]?.className.includes('relative'));
  });

  it('holds the header still outside the scroller', () => {
    const { container } = render(
      <PanelFrame header={<h1>Report</h1>}>
        <p>A stack of figures</p>
      </PanelFrame>,
    );

    assert.ok(screen.getByText('Report'));
    assert.equal(
      container.querySelector('.overflow-y-auto')?.contains(screen.getByText('Report')),
      false,
    );
    assert.ok(container.querySelector('[data-page-frame]'));
  });

  it('shows the open tab and keeps the strip beside the others', () => {
    render(<PanelFrame header={<h1>Report</h1>} tabs={tabs} />);

    assert.ok(screen.getByRole('tab', { name: 'Score card' }));
    assert.ok(screen.getByRole('tab', { name: 'Compare' }));
    assert.ok(screen.getByText('What they scored'));
    assert.equal(screen.queryByText('Who else sat it'), null);
  });
});

describe('PanelFrame — the filter bar', () => {
  const state = {
    values: { q: '', branch: '' },
    setFilter: () => undefined,
    clearFilters: () => undefined,
  };
  const spec = [
    { key: 'q', kind: 'search', label: 'Search', primary: true },
    {
      key: 'branch',
      kind: 'choice',
      label: 'Branch',
      primary: true,
      items: [{ value: '', label: 'Any branch' }],
    },
  ] as const;

  /** The same bar a list screen draws, in the same place: inside the card, above the body. */
  it('draws the spec as a bar above the body', () => {
    render(
      <TooltipProvider>
        <PanelFrame header={<h1>Report</h1>} filters={{ spec, state }}>
          <p>The body</p>
        </PanelFrame>
      </TooltipProvider>,
    );

    assert.ok(screen.getByRole('searchbox', { name: 'Search' }));
    assert.ok(screen.getByRole('button', { name: 'Branch' }));
    assert.ok(screen.getByText('The body'));
  });

  /** A page with nothing to filter must not grow an empty bar where the row would be. */
  it('draws no bar for a page with no filters', () => {
    render(
      <PanelFrame header={<h1>Report</h1>}>
        <p>The body</p>
      </PanelFrame>,
    );

    assert.equal(screen.queryByRole('searchbox'), null);
    assert.equal(screen.queryByRole('button', { name: 'Clear' }), null);
    assert.ok(screen.getByText('The body'));
  });

  /** An empty spec draws the same nothing whether `filters` is entirely absent or just empty. */
  it('draws no bar for an empty spec with no leading control', () => {
    const { container } = render(
      <PanelFrame header={<h1>Report</h1>} filters={{ spec: [], state }}>
        <p>The body</p>
      </PanelFrame>,
    );

    // The header's own `shrink-0` wrapper is the only one — no second one for an empty bar.
    assert.equal(container.querySelectorAll('.shrink-0').length, 1);
    assert.ok(screen.getByText('The body'));
  });

  /** A mandatory scope still needs a bar to sit in, even with nothing beside it to filter. */
  it('draws the bar for a leading control alone, with an empty spec', () => {
    const { container } = render(
      <PanelFrame
        header={<h1>Report</h1>}
        filters={{ spec: [], state, leading: <span>Board</span> }}
      >
        <p>The body</p>
      </PanelFrame>,
    );

    assert.equal(container.querySelectorAll('.shrink-0').length, 2);
    assert.ok(screen.getByText('Board'));
    assert.ok(screen.getByText('The body'));
  });

  it('keeps the body the only scroller when it also carries a bar', () => {
    const { container } = render(
      <TooltipProvider>
        <PanelFrame header={<h1>Report</h1>} filters={{ spec, state }}>
          <p>The body</p>
        </PanelFrame>
      </TooltipProvider>,
    );

    const scrollers = container.querySelectorAll('.overflow-y-auto');
    assert.equal(scrollers.length, 1);
    assert.equal(scrollers[0]?.contains(screen.getByRole('searchbox', { name: 'Search' })), false);
  });
});

describe('TableFrame — tabs', () => {
  const tabs = {
    value: 'draft',
    onValueChange: () => undefined,
    items: [
      { value: 'draft', label: 'Draft', content: <p>The form</p> },
      { value: 'sent', label: 'Sent', content: <p>The record</p> },
    ],
  };

  /** The failure this prevents: a TabsList rendered outside a Tabs root, which Radix throws on. */
  it('roots its tabs and shows only the open one', () => {
    const { container } = render(<TableFrame header={<h1>Questions</h1>} tabs={tabs} />);

    assert.ok(screen.getByRole('tab', { name: 'Draft' }));
    assert.ok(screen.getByText('The form'));
    assert.equal(screen.queryByText('The record'), null);
    assert.ok(container.querySelector('[data-page-frame]'));
  });
});

describe('SplitFrame', () => {
  const state = {
    values: { branch: '' },
    setFilter: () => undefined,
    clearFilters: () => undefined,
  };
  const spec = [
    { key: 'branch', kind: 'choice', label: 'Branch', items: [{ value: '', label: 'Any branch' }] },
  ] as const;

  /** What the rows are asked by sits beside them, so nothing above a table pushes it down the page. */
  it('names each filter in the side card, apart from the card the rows are in', () => {
    render(
      <TooltipProvider>
        <SplitFrame header={<h1>Merit list</h1>} filters={{ spec, state }} side={<p>Figures</p>}>
          <p>The rows</p>
        </SplitFrame>
      </TooltipProvider>,
    );

    const side = screen.getByText('Figures').parentElement;
    assert.ok(side?.contains(screen.getByLabelText('Branch')));
    assert.equal(screen.getByText('The rows').parentElement?.contains(side ?? null), false);
  });

  /** Folded away, the panel still has to leave the one control that brings it back. */
  it('folds its side card away and brings it back', () => {
    render(
      <SplitFrame collapsible side={<p>Figures</p>}>
        <p>The rows</p>
      </SplitFrame>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Hide the side panel' }));
    assert.equal(screen.queryByText('Figures'), null);
    assert.ok(screen.getByText('The rows'));

    fireEvent.click(screen.getByRole('button', { name: 'Show the side panel' }));
    assert.ok(screen.getByText('Figures'));
  });

  /** The failure this prevents: a card that scrolls around a table that scrolls. */
  it('leaves a body that fills without a scroller of its own', () => {
    render(
      <SplitFrame fills side={<p>Figures</p>}>
        <p>The rows</p>
      </SplitFrame>,
    );

    assert.equal(
      screen.getByText('The rows').parentElement?.className.includes('overflow-y'),
      false,
    );
    assert.ok(screen.getByText('Figures').parentElement?.className.includes('lg:overflow-y-auto'));
  });
});
