import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { cleanup, render, screen } from '@testing-library/react';
import { DataTable, type DataTableColumn } from '../src/components/ui/data-table';
import { PAGE_CONTENT_CLASS, TableFrame } from '../src/components/ui/table-frame';

afterEach(cleanup);

interface Row {
  id: string;
  name: string;
}

const columns: DataTableColumn<Row>[] = [
  { key: 'name', header: 'Student', cell: (r) => r.name },
  { key: 'actions', cell: () => null },
];

const rows: Row[] = [
  { id: '1', name: 'Ravi' },
  { id: '2', name: 'Asha' },
];

const table = () => (
  <DataTable
    columns={columns}
    rows={rows}
    rowKey={(r) => r.id}
    isLoading={false}
    empty="None yet."
  />
);

/** thead, tbody, and the div that owns the scrollbar. */
const groups = () => {
  const [head, body] = screen.getAllByRole('rowgroup');
  const scroller = document.querySelector('table')?.parentElement;
  assert.ok(head, 'the table should render a thead');
  assert.ok(body, 'the table should render a tbody');
  assert.ok(scroller, 'the table should sit in a wrapper that owns the scrollbar');
  return { head, body, scroller };
};

describe('TableFrame', () => {
  /** A framed page stops the wrapper scrolling, not its padding; zeroing the bottom gave the frame the last pixel of the viewport and sat the card on the page edge. */
  it('keeps the page padding it is framed inside', () => {
    assert.ok(
      !/pb-0/.test(PAGE_CONTENT_CLASS),
      'the frame shortens to fit the padding; it does not eat it',
    );
    assert.match(PAGE_CONTENT_CLASS, /\bpy-\d/);
  });

  /** The shell's content wrapper reacts to this attribute; without it the page scrolls. */
  it('marks the page as framed', () => {
    const { container } = render(<TableFrame>{table()}</TableFrame>);
    assert.ok(container.querySelector('[data-page-frame]'));
  });

  it('pins the header and the toolbar around the table', () => {
    render(
      <TableFrame header={<h1>Students</h1>} toolbar={<input aria-label="Search" />}>
        {table()}
      </TableFrame>,
    );

    assert.ok(screen.getByRole('heading', { name: 'Students' }));
    assert.ok(screen.getByRole('textbox', { name: 'Search' }));
  });

  /** Inside a frame the body is the only scroller. */
  it('hands the table its own scrollbar inside a frame', () => {
    render(<TableFrame>{table()}</TableFrame>);
    assert.match(groups().scroller.className, /overflow-auto/);
    assert.match(groups().scroller.className, /flex-1/);
  });
});
