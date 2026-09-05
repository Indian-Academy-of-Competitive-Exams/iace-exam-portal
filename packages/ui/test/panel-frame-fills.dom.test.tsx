import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { cleanup, render, screen } from '@testing-library/react';
import { DataTable } from '../src/components/ui/data-table';
import { PanelFrame } from '../src/components/ui/table-frame';

afterEach(cleanup);

const tabs = {
  value: 'quant',
  onValueChange: () => undefined,
  items: [
    { value: 'quant', label: 'Quantitative Aptitude 12/25', content: <p>The quant pane</p> },
    { value: 'reasoning', label: 'Reasoning 0/20', content: <p>The reasoning pane</p> },
  ],
};

describe('PanelFrame — fills', () => {
  /** The shell only stops scrolling the whole page when it :has() this attribute. */
  it('marks itself as the page frame', () => {
    const { container } = render(
      <PanelFrame fills header={<h1>Paper</h1>}>
        <p>body</p>
      </PanelFrame>,
    );

    assert.ok(container.querySelector('[data-page-frame]'));
  });

  /** The whole point: no scrollbar of its own, so the lists inside can own their scroll. */
  it('leaves the body without an overflow class of its own', () => {
    const { container } = render(
      <PanelFrame fills header={<h1>Paper</h1>}>
        <p>body</p>
      </PanelFrame>,
    );

    const body = screen.getByText('body').parentElement;
    assert.ok(body?.className.includes('min-h-0'));
    assert.ok(body?.className.includes('flex-1'));
    assert.equal(container.querySelectorAll('[class*="overflow-y"]').length, 0);
  });

  /** The failure this prevents: a scrollbar inside a scrollbar, one tab panel deep. */
  it('leaves the open tab panel without an overflow class either', () => {
    const { container } = render(<PanelFrame fills header={<h1>Paper</h1>} tabs={tabs} />);

    const panel = screen.getByText('The quant pane').parentElement;
    assert.ok(panel?.className.includes('min-h-0'));
    assert.ok(panel?.className.includes('flex-1'));
    assert.equal(container.querySelectorAll('[class*="overflow-y"]').length, 0);
  });

  /** Without it nothing changes: the body scrolls, as every other panel screen expects. */
  it('still scrolls its own body when fills is absent', () => {
    const { container } = render(
      <PanelFrame header={<h1>Report</h1>}>
        <p>body</p>
      </PanelFrame>,
    );

    assert.equal(container.querySelectorAll('.overflow-y-auto').length, 1);
  });

  /** The frame owns the height here, so a paging list must not also cap itself half way down it. */
  it('lets a paging table fill the pane instead of capping', () => {
    render(
      <PanelFrame fills>
        <DataTable
          columns={[{ key: 'name', header: 'Name', cell: () => 'Alpha' }]}
          rows={[{ id: 'a' }]}
          rowKey={(row) => row.id}
          isLoading={false}
          empty="none"
          scroll={{ hasMore: true }}
        />
      </PanelFrame>,
    );

    const scroller = screen.getByRole('table').parentElement;
    assert.match(scroller?.className ?? '', /flex-1/);
    assert.ok(!scroller?.className.includes('max-h-'));
  });

  /** A tab past the edge is clipped away by the card, so the strip has to be reachable by scroll. */
  it('lets a strip longer than its width scroll sideways', () => {
    render(<PanelFrame fills tabs={tabs} />);

    const strip = screen.getByRole('tab', { name: 'Reasoning 0/20' }).parentElement;
    assert.ok(strip?.className.includes('overflow-x-auto'));
  });

  /** The strip is where the open tab is acted on, so its action rides the same row as the tabs. */
  it('holds an action at the strip\u0027s right end, beside the tabs', () => {
    render(<PanelFrame fills tabs={{ ...tabs, action: <button type="button">Save</button> }} />);

    const strip = screen.getByRole('tab', { name: 'Reasoning 0/20' }).parentElement;
    const save = screen.getByRole('button', { name: 'Save' });
    assert.ok(save);
    assert.equal(
      strip?.contains(save),
      false,
      'the action sits beside the tab list, not inside it',
    );
  });
});
