import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { TourSpotlight } from '../src/components/ui/tour-spotlight';

afterEach(cleanup);

const RECT = { top: 100, left: 40, width: 200, height: 48 };

const props = {
  rect: RECT,
  title: 'Your tests',
  body: 'Every test the institute has opened to you.',
  index: 0,
  count: 4,
  onNext: () => {},
  onBack: () => {},
  onClose: () => {},
};

describe('TourSpotlight', () => {
  it('names the step and where it sits in the run', () => {
    render(<TourSpotlight {...props} index={1} />);

    assert.ok(screen.getByText('Your tests'));
    assert.ok(screen.getByText('2 of 4'));
  });

  /** A heading would make `no-narration` read tour copy as a narrative title. */
  it('writes the step title as a paragraph, not a heading', () => {
    render(<TourSpotlight {...props} />);

    assert.equal(screen.queryByRole('heading'), null);
  });

  it('ends the run on the last step rather than offering another', () => {
    render(<TourSpotlight {...props} index={3} />);

    assert.ok(screen.getByRole('button', { name: 'Done' }));
    assert.equal(screen.queryByRole('button', { name: 'Next' }), null);
  });

  it('offers no way back from the first step', () => {
    render(<TourSpotlight {...props} />);

    assert.equal(screen.queryByRole('button', { name: 'Back' }), null);
  });

  it('offers the way back from every step after it', () => {
    render(<TourSpotlight {...props} index={1} />);

    assert.ok(screen.getByRole('button', { name: 'Back' }));
  });

  it('advances on Next', () => {
    let advanced = 0;
    render(<TourSpotlight {...props} onNext={() => (advanced += 1)} />);

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    assert.equal(advanced, 1);
  });

  it('steps back on Back', () => {
    let back = 0;
    render(<TourSpotlight {...props} index={2} onBack={() => (back += 1)} />);

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));

    assert.equal(back, 1);
  });

  it('closes on Skip the tour', () => {
    let closed = 0;
    render(<TourSpotlight {...props} onClose={() => (closed += 1)} />);

    fireEvent.click(screen.getByRole('button', { name: 'Skip the tour' }));

    assert.equal(closed, 1);
  });

  it('closes on Done', () => {
    let closed = 0;
    render(<TourSpotlight {...props} index={3} onClose={() => (closed += 1)} />);

    fireEvent.click(screen.getByRole('button', { name: 'Done' }));

    assert.equal(closed, 1);
  });

  it('cuts the dim out where the rect says', () => {
    render(<TourSpotlight {...props} />);

    const hole = document.querySelector('[data-tour-cutout]');

    assert.ok(hole instanceof HTMLElement);
    assert.deepEqual(
      [hole.style.top, hole.style.left, hole.style.width, hole.style.height],
      ['100px', '40px', '200px', '48px'],
    );
  });

  /** Nothing on the page below may be clicked mid-tour, or the reader navigates out of the run. */
  it('lays a blocker over the page', () => {
    let closed = 0;
    render(<TourSpotlight {...props} onClose={() => (closed += 1)} />);

    const blocker = document.querySelector('[data-tour-blocker]');
    assert.ok(blocker instanceof HTMLElement);

    fireEvent.click(blocker);
    assert.equal(closed, 1);
  });
});
