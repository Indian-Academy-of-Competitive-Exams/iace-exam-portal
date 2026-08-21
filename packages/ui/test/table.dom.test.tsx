import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { cleanup, render, screen } from '@testing-library/react';
import { DataTable, type DataTableColumn } from '../src/components/ui/data-table';
import { PAGE_CONTENT_CLASS, TableFrame } from '../src/components/ui/table-frame';
import { Pagination } from '../src/components/ui/pagination';

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

describe('table rows', () => {
  /**
   * Nothing in a heading row is clickable, so a highlight there offers something
   * that is not on offer. The hover belongs to the body and is scoped to its own
   * rows, so it cannot reach a thead however the rows are composed.
   */
  it('offer hover on the body only, never on the heading', () => {
    render(table());
    const { head, body } = groups();

    assert.ok(!head.innerHTML.includes('hover'), 'no hover styling anywhere in the thead');
    assert.match(body.className, /\[&>tr:hover>td\]:/);
  });

  /**
   * The fill is a pseudo-element inset from the rules and rounded at the row's two
   * ends. The radius has to be on the band and not the cell: on the cell it would
   * round the `border-b` with it, bending the rule away from the table edge.
   */
  it('tint a hovered row inside its rules, rounding the band and not the rule', () => {
    render(table());

    assert.match(groups().body.className, /\[&>tr:hover>td\]:before:bg-muted/);

    const cell = screen.getByRole('cell', { name: 'Ravi' });
    assert.match(cell.className, /before:inset-y-\[3px\]/, 'clear of both rules');
    assert.match(cell.className, /first:before:rounded-l-md/, 'rounded at the row ends only');
    assert.match(cell.className, /last:before:rounded-r-md/);
    assert.ok(
      !/(^|\s)(first|last):rounded/.test(cell.className),
      'a radius on the cell itself would bend its border-b',
    );
  });

  /** A collapsed table drops the borders on a sticky heading row. */
  it('hold the heading still while the body scrolls', () => {
    render(table());
    const heading = screen.getByRole('columnheader', { name: 'Student' });

    assert.match(heading.className, /sticky/);
    assert.match(heading.className, /top-0/);
    assert.match(heading.className, /bg-card/, 'or rows show through it');
    assert.match(document.querySelector('table')?.className ?? '', /border-separate/);
  });

  /** `border-separate` renders no `<tr>` border, and a sticky heading keeps a cell one. */
  it('draw their rules on the cells, not the row', () => {
    render(table());
    const { body } = groups();

    assert.match(screen.getByRole('cell', { name: 'Ravi' }).className, /border-b border-border/);
    assert.ok(!body.querySelector('tr')?.className.includes('border-b'));
  });

  /** Pagination closes the box with a border-t of its own. */
  it('stop at the last row', () => {
    render(table());
    assert.match(groups().body.className, /\[&>tr:last-child>td\]:border-b-0/);

    cleanup();
    const { container } = render(
      <Pagination page={1} pageSize={10} total={2} onPageChange={() => {}} />,
    );
    assert.match(container.firstElementChild?.className ?? '', /border-t/);
  });
});

describe('TableFrame', () => {
  /**
   * A framed page stops the wrapper scrolling, not its padding. Zeroing the bottom
   * gave the frame the last pixel of the viewport and sat the card on the page edge.
   */
  it('keeps the page padding it is framed inside', () => {
    assert.ok(
      !/pb-0/.test(PAGE_CONTENT_CLASS),
      'the frame shortens to fit the padding; it does not eat it',
    );
    assert.match(PAGE_CONTENT_CLASS, /\bpy-\d/);
  });

  /** The shell's content wrapper reacts to this attribute; without it the page scrolls. */
  it('marks the page as framed only when it is', () => {
    const { container, rerender } = render(<TableFrame>{table()}</TableFrame>);
    assert.ok(container.querySelector('[data-page-frame]'));

    rerender(<TableFrame framed={false}>{table()}</TableFrame>);
    assert.equal(container.querySelector('[data-page-frame]'), null);
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

  /** Inside a frame the body is the only scroller; outside, the page still scrolls. */
  it('hands the table its own scrollbar only inside a frame', () => {
    const { rerender } = render(<TableFrame>{table()}</TableFrame>);
    assert.match(groups().scroller.className, /overflow-auto/);
    assert.match(groups().scroller.className, /flex-1/);

    rerender(<TableFrame framed={false}>{table()}</TableFrame>);
    assert.match(groups().scroller.className, /overflow-x-auto/);
    assert.ok(!groups().scroller.className.includes('flex-1'));
  });
});
