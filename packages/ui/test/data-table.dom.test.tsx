import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { cleanup, render, screen } from '@testing-library/react';
import { DataTable, type DataTableColumn } from '../src/components/ui/data-table';

afterEach(cleanup);

interface Row {
  id: string;
  name: string;
  mobile: string;
}

const columns: DataTableColumn<Row>[] = [
  { key: 'name', header: 'Student', cell: (r) => r.name },
  { key: 'mobile', header: 'Mobile', cell: (r) => r.mobile },
  { key: 'actions', cell: () => null },
];

const rows: Row[] = [
  { id: '1', name: 'Ravi', mobile: '9876543210' },
  { id: '2', name: 'Asha', mobile: '9876543211' },
];

const table = (props: Partial<React.ComponentProps<typeof DataTable<Row>>> = {}) => (
  <DataTable
    columns={columns}
    rows={rows}
    rowKey={(r) => r.id}
    isLoading={false}
    empty="No students yet."
    {...props}
  />
);

const bodyRows = () => screen.getAllByRole('rowgroup')[1]?.querySelectorAll('tr') ?? [];

describe('DataTable', () => {
  it('renders a row per item, under the headers', () => {
    render(table());

    assert.equal(bodyRows().length, 2);
    assert.ok(screen.getByRole('columnheader', { name: 'Student' }));
    assert.ok(screen.getByRole('cell', { name: 'Ravi' }));
  });

  /** A word centred in an empty table drops the column widths. */
  it('holds its shape while loading, with a row per expected row', () => {
    render(table({ isLoading: true, rows: [], skeletonRows: 3 }));

    assert.equal(bodyRows().length, 3);
    assert.equal(bodyRows()[0]?.querySelectorAll('td').length, columns.length);
    assert.equal(screen.queryByText('No students yet.'), null);
  });

  it('says nothing is there only when nothing is', () => {
    render(table({ rows: [] }));

    assert.ok(screen.getByText('No students yet.'));
    assert.equal(bodyRows().length, 1);
  });

  /** The empty row has to span the table, or it sits squashed under one heading. */
  it('spans the empty row across every column', () => {
    render(table({ rows: [] }));

    assert.equal(
      screen.getByText('No students yet.').getAttribute('colspan'),
      String(columns.length),
    );
  });

  /** `loading` is the opt-out for a wait that has something to say. */
  it('shows a loading message instead of the skeleton when given one', () => {
    render(table({ isLoading: true, rows: [], loading: 'Reading the file…' }));

    assert.ok(screen.getByText('Reading the file…'));
    assert.equal(bodyRows().length, 1);
  });

  it('renders a footer only when there is one', () => {
    const { rerender } = render(table());
    assert.equal(screen.queryByTestId('footer'), null);

    rerender(table({ footer: <div data-testid="footer">1–2 of 2</div> }));
    assert.ok(screen.getByTestId('footer'));
  });
});
