import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { FilterBar } from '../src/components/ui/filter-bar';

afterEach(cleanup);

const search = <input aria-label="Search" key="s" />;
const folded = <input aria-label="Branch" key="b" />;

describe('FilterBar', () => {
  it('offers no Clear while nothing is filtered', () => {
    render(
      <FilterBar activeCount={0} onClear={() => {}}>
        {search}
      </FilterBar>,
    );

    assert.equal(screen.queryByRole('button', { name: /Clear filters/ }), null);
  });

  /** The whole point of the directive: it is reachable without opening the fold first. */
  it('shows Clear beside the controls, not inside the fold', () => {
    render(
      <FilterBar activeCount={2} onClear={() => {}} advanced={folded}>
        {search}
      </FilterBar>,
    );

    assert.ok(screen.getByRole('button', { name: /Clear filters/ }));
    assert.equal(screen.queryByLabelText('Branch'), null, 'the fold is still shut');
  });

  it('reports how many filters Clear would drop', () => {
    render(
      <FilterBar activeCount={3} onClear={() => {}}>
        {search}
      </FilterBar>,
    );

    assert.match(screen.getByRole('button', { name: /Clear filters/ }).textContent ?? '', /3/);
  });

  it('clears on click', () => {
    const onClear = mock.fn();
    render(
      <FilterBar activeCount={1} onClear={onClear}>
        {search}
      </FilterBar>,
    );

    fireEvent.click(screen.getByRole('button', { name: /Clear filters/ }));
    assert.equal(onClear.mock.callCount(), 1);
  });

  it('opens and shuts the fold', () => {
    render(
      <FilterBar activeCount={0} onClear={() => {}} advanced={folded}>
        {search}
      </FilterBar>,
    );

    assert.equal(screen.queryByLabelText('Branch'), null);
    fireEvent.click(screen.getByRole('button', { name: /Filters/ }));
    assert.ok(screen.getByLabelText('Branch'));
  });

  /** A filter that is set but hidden is a table lying about why it is short. */
  it('opens itself when a folded filter is already set', () => {
    render(
      <FilterBar activeCount={1} advancedCount={1} onClear={() => {}} advanced={folded}>
        {search}
      </FilterBar>,
    );

    assert.ok(screen.getByLabelText('Branch'));
    assert.match(screen.getByRole('button', { name: /Filters/ }).textContent ?? '', /1/);
  });

  it('has no toggle at all when nothing folds', () => {
    render(
      <FilterBar activeCount={0} onClear={() => {}}>
        {search}
      </FilterBar>,
    );

    assert.equal(screen.queryByRole('button', { name: /Filters/ }), null);
  });
});
