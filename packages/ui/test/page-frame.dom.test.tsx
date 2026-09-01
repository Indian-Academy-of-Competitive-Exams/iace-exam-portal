import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { cleanup, render, screen } from '@testing-library/react';
import { PageFrame, PanelFrame } from '../src/components/ui/table-frame';

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
