import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { cleanup, render, screen } from '@testing-library/react';
import { ScrollWindow } from '../src/components/ui/scroll-window';

afterEach(cleanup);

const KEYS = Array.from({ length: 12 }, (_, index) => `q${index + 1}`);

const windowOf = (open: boolean, scrollTo: { key: string } | null) => (
  <ScrollWindow
    open={open}
    onOpenChange={() => {}}
    title="Section questions"
    header={<span>pinned header</span>}
    itemKeys={KEYS}
    onActiveChange={() => {}}
    scrollTo={scrollTo}
    renderItem={(index) => <p>{`body of ${KEYS[index]}`}</p>}
  />
);

function show(
  onActiveChange: (index: number) => void = () => {},
  scrollTo: { key: string } | null = null,
) {
  render(
    <ScrollWindow
      open
      onOpenChange={() => {}}
      title="Section questions"
      header={<span>pinned header</span>}
      itemKeys={KEYS}
      onActiveChange={onActiveChange}
      scrollTo={scrollTo}
      renderItem={(index) => <p>{`body of ${KEYS[index]}`}</p>}
    />,
  );
}

describe('ScrollWindow', () => {
  /** The failure this prevents: a section of hundreds mounting an editor for every question at once. */
  it('gives a live body only to the items near the one in view', () => {
    show();

    assert.ok(screen.getByText('body of q1'));
    assert.ok(screen.getByText('body of q3'));
    assert.equal(screen.queryByText('body of q4'), null);
    assert.equal(document.querySelectorAll('[data-item-key]').length, KEYS.length);
  });

  it('keeps the header outside the one scroller', () => {
    show();

    const scrollers = document.querySelectorAll('[class*="overflow-y-auto"]');
    assert.equal(scrollers.length, 1);
    assert.ok(!scrollers[0]?.contains(screen.getByText('pinned header')));
  });

  it('starts on the first item', () => {
    const seen: number[] = [];
    show((index) => seen.push(index));

    assert.equal(seen[0], 0);
  });

  /** The failure this prevents: opening a question far down landing on a placeholder, two items early. */
  it('mounts the item a jump asks for at once, without waiting on a scroll', () => {
    const seen: number[] = [];
    show((index) => seen.push(index), { key: 'q10' });

    assert.ok(screen.getByText('body of q10'));
    assert.equal(seen.at(-1), 9);
  });

  /** The failure this prevents: reopening at the top with only a far-down question alive, so the view is blank. */
  it('starts at the first item again when reopened', () => {
    const jump = { key: 'q10' };
    const { rerender } = render(windowOf(true, jump));
    rerender(windowOf(false, jump));
    rerender(windowOf(true, null));

    assert.ok(screen.getByText('body of q1'));
  });
});
