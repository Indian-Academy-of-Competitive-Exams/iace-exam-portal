import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import {
  FilterRow,
  type FilterState,
  type ListFilter,
  type ListFilterValue,
} from '../src/components/ui/list-view';

afterEach(cleanup);

const SEARCH: ListFilter = { key: 'q', kind: 'search', label: 'Search rows', primary: true };
const BRANCH: ListFilter = {
  key: 'branch',
  kind: 'choice',
  label: 'Branch',
  items: [
    { value: '', label: 'Any branch' },
    { value: 'ameerpet', label: 'Ameerpet' },
  ],
};

function row(
  values: Record<string, ListFilterValue> = {},
  filters: readonly ListFilter[] = [SEARCH, BRANCH],
  clearFilters: FilterState['clearFilters'] = () => {},
) {
  return render(
    <FilterRow state={{ values, setFilter: () => {}, clearFilters }} filters={filters} />,
  );
}

describe('FilterRow', () => {
  it('offers no Clear while nothing is filtered', () => {
    row();

    assert.equal(screen.queryByRole('button', { name: /Clear filters/ }), null);
  });

  /** Reachable without opening the fold first. */
  it('shows Clear beside the controls, not inside the fold', () => {
    row({ q: 'asha' });

    assert.ok(screen.getByRole('button', { name: /Clear filters/ }));
    assert.equal(screen.queryByLabelText('Branch'), null, 'the fold is still shut');
  });

  it('reports how many filters Clear would drop, and clears on click', () => {
    const clearFilters = mock.fn();
    row({ q: 'asha', branch: 'ameerpet' }, [SEARCH, BRANCH], clearFilters);

    const clear = screen.getByRole('button', { name: /Clear filters/ });
    assert.match(clear.textContent ?? '', /2/);
    fireEvent.click(clear);
    assert.equal(clearFilters.mock.callCount(), 1);
  });

  it('opens and shuts the fold', () => {
    row();

    assert.equal(screen.queryByLabelText('Branch'), null);
    fireEvent.click(screen.getByRole('button', { name: /Filters/ }));
    assert.ok(screen.getByLabelText('Branch'));
  });

  /** A filter that is set but hidden is a table lying about why it is short. */
  it('opens itself when a folded filter is already set', () => {
    row({ branch: 'ameerpet' });

    assert.ok(screen.getByLabelText('Branch'));
    assert.match(screen.getByRole('button', { name: /^Filters/ }).textContent ?? '', /1/);
  });

  it('has no toggle at all when nothing folds', () => {
    row({}, [SEARCH]);

    assert.equal(screen.queryByRole('button', { name: /Filters/ }), null);
  });

  it('names a primary control from its notch, so clicking the name reaches the control', () => {
    row();

    assert.equal(screen.getByText('Search rows').closest('label')?.htmlFor, 'filter-q');
  });
});
