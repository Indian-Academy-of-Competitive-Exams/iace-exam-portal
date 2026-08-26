import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import * as React from 'react';
import { DataTable, type DataTableColumn } from '../src/components/ui/data-table';
import { TableFrame } from '../src/components/ui/table-frame';

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

describe('DataTable selection', () => {
  const rows = [
    { id: 'a', name: 'Alpha' },
    { id: 'b', name: 'Beta' },
  ];
  const columns = [{ key: 'name', header: 'Name', cell: (row: (typeof rows)[number]) => row.name }];

  const table = (
    selected: ReadonlySet<string>,
    onChange: (next: ReadonlySet<string>) => void = () => {},
  ) =>
    render(
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        isLoading={false}
        empty="none"
        selection={{ selected, onChange }}
      />,
    );

  it('draws no checkbox column when no selection is offered', () => {
    render(
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        isLoading={false}
        empty="none"
      />,
    );

    assert.equal(screen.queryAllByRole('checkbox').length, 0);
  });

  it('draws one per row plus the header', () => {
    table(new Set());

    assert.equal(screen.getAllByRole('checkbox').length, rows.length + 1);
  });

  it('reports the row that was ticked, keeping what was already chosen', () => {
    let got: ReadonlySet<string> = new Set();
    table(new Set(['a']), (next) => (got = next));

    fireEvent.click(screen.getByLabelText('Select row b'));

    assert.deepEqual([...got].sort(), ['a', 'b']);
  });

  /** Only the rows on screen: a header box that silently took the other nine pages would be a lie. */
  it('takes every row shown, and only those', () => {
    let got: ReadonlySet<string> = new Set();
    table(new Set(['elsewhere']), (next) => (got = next));

    fireEvent.click(screen.getByLabelText('Select every row shown'));

    assert.deepEqual([...got].sort(), ['a', 'b', 'elsewhere']);
  });

  it('the header reads as ticked only when every row shown is', () => {
    table(new Set(['a', 'b']));

    assert.ok((screen.getByLabelText('Select every row shown') as HTMLInputElement).checked);
  });
});

describe('DataTable expandable rows', () => {
  const rows = [
    { id: 'a', name: 'Alpha' },
    { id: 'b', name: 'Beta' },
  ];
  const columns = [{ key: 'name', header: 'Name', cell: (row: (typeof rows)[number]) => row.name }];

  const table = () =>
    render(
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        isLoading={false}
        empty="none"
        expand={{
          render: (row) => <p>Children of {row.name}</p>,
          label: (row) => `Show the children of ${row.name}`,
        }}
      />,
    );

  it('draws no chevron when a row has nothing to open', () => {
    render(
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        isLoading={false}
        empty="none"
      />,
    );

    assert.equal(screen.queryByLabelText('Show the children of Alpha'), null);
  });

  it('keeps the panel shut until it is asked for', () => {
    table();

    assert.equal(screen.queryByText('Children of Alpha'), null);
  });

  it('opens the row that was clicked, and only that one', () => {
    table();
    fireEvent.click(screen.getByLabelText('Show the children of Alpha'));

    assert.ok(screen.getByText('Children of Alpha'));
    assert.equal(screen.queryByText('Children of Beta'), null);
  });

  /** Two open at once: comparing one exam's stages with another is the reason to expand in place. */
  it('holds more than one open', () => {
    table();
    fireEvent.click(screen.getByLabelText('Show the children of Alpha'));
    fireEvent.click(screen.getByLabelText('Show the children of Beta'));

    assert.ok(screen.getByText('Children of Alpha'));
    assert.ok(screen.getByText('Children of Beta'));
  });

  it('shuts again on a second click', () => {
    table();
    const toggle = screen.getByLabelText('Show the children of Alpha');

    fireEvent.click(toggle);
    fireEvent.click(toggle);

    assert.equal(screen.queryByText('Children of Alpha'), null);
  });

  it('says whether it is open, since a chevron alone tells a screen reader nothing', () => {
    table();
    const toggle = screen.getByLabelText('Show the children of Alpha');

    assert.equal(toggle.getAttribute('aria-expanded'), 'false');
    fireEvent.click(toggle);
    assert.equal(toggle.getAttribute('aria-expanded'), 'true');
  });

  /** A long child list must not push the parent rows off the screen used to navigate them. */
  it('gives the panel its own capped scrollport', () => {
    const { container } = table();
    fireEvent.click(screen.getByLabelText('Show the children of Alpha'));

    const panel = container.querySelector('.overflow-y-auto');
    assert.ok(panel, 'the panel scrolls inside itself');
    assert.match(panel?.className ?? '', /max-h-/);
  });
});

describe('where the footer sits', () => {
  const pager = <div data-testid="pager">1–10 of 40</div>;

  const framed = (wrap: (table: React.ReactNode) => React.ReactNode) =>
    render(
      <TableFrame>
        {wrap(
          <DataTable
            columns={columns}
            rows={rows}
            rowKey={(row) => row.id}
            isLoading={false}
            empty="none"
            footer={pager}
          />,
        )}
      </TableFrame>,
    );

  /** It returned a fragment, so the pager pinned only if the PARENT happened to be right. */
  it('keeps the table and the pager in one column of its own', () => {
    const { container } = framed((table) => table);
    const column = container.querySelector('[data-testid="pager"]')?.parentElement;

    assert.match(column?.className ?? '', /flex-col/);
    assert.match(column?.className ?? '', /flex-1/);
    assert.match(column?.className ?? '', /min-h-0/);
  });

  it('puts the pager last, under the scroller', () => {
    const { container } = framed((table) => table);
    const column = container.querySelector('[data-testid="pager"]')?.parentElement;

    assert.equal(column?.lastElementChild?.getAttribute('data-testid'), 'pager');
    assert.match(column?.firstElementChild?.className ?? '', /overflow-auto/);
  });

  /** The case that raised it: a plain wrapper between the frame and the table must not matter. */
  it('does the same inside a wrapper that is not a flex column', () => {
    const { container } = framed((table) => <div>{table}</div>);
    const column = container.querySelector('[data-testid="pager"]')?.parentElement;

    assert.match(column?.className ?? '', /flex-col/);
    assert.equal(column?.lastElementChild?.getAttribute('data-testid'), 'pager');
  });
});

describe('DataTable that scrolls instead of paging', () => {
  const viewport = () => screen.getByRole('table').parentElement as HTMLElement;

  const scrollTo = (top: number, scrollHeight: number, clientHeight: number) => {
    const element = viewport();
    for (const [key, value] of Object.entries({ scrollTop: top, scrollHeight, clientHeight })) {
      Object.defineProperty(element, key, { value, configurable: true });
    }
    fireEvent.scroll(element);
  };

  /** The failure this prevents: a pool that silently ends at its first page. */
  it('asks for the next page as the reader nears the end', () => {
    const calls: number[] = [];
    render(table({ scroll: { hasMore: true, onLoadMore: () => calls.push(1) } }));

    scrollTo(900, 1000, 100);

    assert.equal(calls.length, 1);
  });

  it('asks for nothing while the end is still a screen away', () => {
    const calls: number[] = [];
    render(table({ scroll: { hasMore: true, onLoadMore: () => calls.push(1) } }));

    scrollTo(0, 1000, 100);

    assert.equal(calls.length, 0);
  });

  it('asks for nothing once every page has arrived', () => {
    const calls: number[] = [];
    render(table({ scroll: { hasMore: false, onLoadMore: () => calls.push(1) } }));

    scrollTo(900, 1000, 100);

    assert.equal(calls.length, 0);
  });
});
