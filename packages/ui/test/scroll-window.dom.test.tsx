import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { cleanup, render, screen } from '@testing-library/react';
import { ScrollWindow } from '../src/components/ui/scroll-window';

afterEach(cleanup);

const KEYS = Array.from({ length: 12 }, (_, index) => `q${index + 1}`);

function show(onActiveChange: (index: number) => void = () => {}) {
  render(
    <ScrollWindow
      open
      onOpenChange={() => {}}
      title="Section questions"
      header={<span>pinned header</span>}
      itemKeys={KEYS}
      onActiveChange={onActiveChange}
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
});
