import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { cleanup, render, screen } from '@testing-library/react';
import { PageFrame } from '../src/components/ui/table-frame';

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
