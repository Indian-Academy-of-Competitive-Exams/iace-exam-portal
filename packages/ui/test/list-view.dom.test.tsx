import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ListView, type ListFilter, type ListState } from '../src/components/ui/list-view';
import { type DataTableColumn } from '../src/components/ui/data-table';
import { TooltipProvider } from '../src/components/ui/tooltip';

afterEach(cleanup);

interface Row {
  id: string;
  name: string;
}

const columns: DataTableColumn<Row>[] = [{ key: 'name', header: 'Name', cell: (r) => r.name }];

const FILTERS: readonly ListFilter[] = [
  { key: 'q', kind: 'search', label: 'Search rows', primary: true },
  {
    key: 'status',
    kind: 'choice',
    label: 'Status',
    items: [
      { value: '', label: 'Any' },
      { value: 'active', label: 'Active' },
    ],
  },
  {
    key: 'difficulty',
    kind: 'multi',
    label: 'Difficulty',
    primary: true,
    placeholder: 'Any difficulty',
    items: [
      { value: 'LOW', label: 'Low' },
      { value: 'MEDIUM', label: 'Medium' },
      { value: 'HIGH', label: 'High' },
    ],
  },
];

function state(over: Partial<ListState<Row>> = {}): ListState<Row> {
  return {
    rows: [],
    isLoading: false,
    hasLoaded: true,
    values: {},
    setFilter: () => {},
    clearFilters: () => {},
    pagination: {
      page: 1,
      pageSize: 20,
      total: 0,
      onPageChange: () => {},
      onPageSizeChange: () => {},
      pageSizeOptions: [20],
    },
    ...over,
  };
}

/** A multi filter with several chosen puts a Tooltip on its trigger; AppProviders supplies one. */
const view = (over: Partial<ListState<Row>> = {}, props = {}) =>
  render(
    <TooltipProvider>
      <ListView
        list={state(over)}
        filters={FILTERS}
        columns={columns}
        rowKey={(r) => r.id}
        empty="No rows yet. Add the first one."
        emptyFiltered="No rows match those filters."
        {...props}
      />
    </TooltipProvider>,
  );

describe('ListView', () => {
  it('says nothing matched when a filter is set, not that there are none', () => {
    view({ values: { q: 'ram' } });

    assert.ok(screen.getByText('No rows match those filters.'));
    assert.equal(screen.queryByText('No rows yet. Add the first one.'), null);
  });

  it('says there are none when no filter is set', () => {
    view();

    assert.ok(screen.getByText('No rows yet. Add the first one.'));
    assert.equal(screen.queryByText('No rows match those filters.'), null);
  });

  it('holds the pager back until a page has arrived', () => {
    view({ isLoading: true, hasLoaded: false });

    assert.equal(screen.queryByRole('button', { name: 'Next' }), null);
  });

  it('shows the pager once a page has arrived, even an empty one', () => {
    view({ total: 0 } as Partial<ListState<Row>>);

    assert.ok(screen.getByRole('button', { name: /Next/ }));
  });

  it('counts a folded filter towards Clear, so a hidden filter is never a silent one', () => {
    view({ values: { status: 'active' } });

    assert.ok(screen.getByRole('button', { name: /Clear filters/ }));
  });

  it('clears through the list, not by emptying each control', () => {
    let cleared = 0;
    view({ values: { q: 'ram' }, clearFilters: () => (cleared += 1) });

    fireEvent.click(screen.getByRole('button', { name: /Clear filters/ }));
    assert.equal(cleared, 1);
  });

  it('draws no filter bar for a list nobody filters', () => {
    render(
      <ListView list={state()} columns={columns} rowKey={(r) => r.id} empty="No admins yet." />,
    );

    assert.equal(screen.queryByRole('button', { name: /Filters/ }), null);
    assert.equal(screen.queryByRole('searchbox'), null);
  });
});

describe('ListView — a multi filter', () => {
  it('names what is chosen on the control itself, however many', () => {
    view({ values: { difficulty: ['LOW'] } });
    assert.equal(screen.getByRole('button', { name: 'Difficulty' }).textContent, 'Low');

    cleanup();
    view({ values: { difficulty: ['LOW', 'HIGH'] } });
    assert.equal(screen.getByRole('button', { name: 'Difficulty' }).textContent, 'Low, High');
  });

  /** The rows are what the reader came for: a growing chip strip would push them down the page. */
  it('keeps the selection on the control, never in a strip under it', () => {
    view({ values: { difficulty: ['LOW', 'HIGH'] } });

    assert.equal(screen.queryByRole('button', { name: 'Remove Low' }), null);
  });

  it('offers no "Any" row — choosing nothing already means all of them', () => {
    view({ values: { difficulty: [] } });

    const trigger = screen.getByRole('button', { name: 'Difficulty' });
    assert.ok(trigger.textContent?.includes('Any difficulty'));
  });

  /** An empty set is "don't care", so it must not light up Clear or the filtered empty state. */
  it('is not an active filter until something is chosen', () => {
    view({ values: { difficulty: [] } });

    assert.equal(screen.queryByRole('button', { name: /Clear filters/ }), null);
    assert.ok(screen.getByText('No rows yet. Add the first one.'));
  });

  it('counts as one active filter once something is chosen', () => {
    view({ values: { difficulty: ['LOW', 'HIGH'] } });

    assert.ok(screen.getByRole('button', { name: /Clear filters/ }));
    assert.ok(screen.getByText('No rows match those filters.'));
  });

  it('hands a set back, never a joined string', () => {
    const seen: unknown[] = [];
    view({ values: { difficulty: ['LOW'] }, setFilter: (_key, value) => seen.push(value) });

    fireEvent.click(screen.getByRole('button', { name: 'Difficulty' }));
    fireEvent.click(screen.getByRole('option', { name: 'High' }));

    assert.deepEqual(seen, [['LOW', 'HIGH']]);
  });
});
