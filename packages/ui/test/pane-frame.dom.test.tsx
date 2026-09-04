import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { cleanup, render, screen } from '@testing-library/react';
import { DataTable } from '../src/components/ui/data-table';
import { PaneFrame } from '../src/components/ui/table-frame';

afterEach(cleanup);

describe('PaneFrame', () => {
  /** The shell only stops scrolling the whole page when it :has() this attribute. */
  it('marks itself as the page frame', () => {
    const { container } = render(
      <PaneFrame header={<h1>Paper builder</h1>}>
        <p>body</p>
      </PaneFrame>,
    );

    assert.ok(container.querySelector('[data-page-frame]'));
  });

  /** The failure this prevents: the header inside the body is a header that scrolls with it. */
  it('keeps the header out of the body, held still', () => {
    render(
      <PaneFrame header={<h1>Paper builder</h1>}>
        <p>body</p>
      </PaneFrame>,
    );

    const body = screen.getByText('body').parentElement;
    assert.equal(body?.contains(screen.getByRole('heading', { name: 'Paper builder' })), false);
    assert.ok(
      screen
        .getByRole('heading', { name: 'Paper builder' })
        .parentElement?.className.includes('shrink-0'),
    );
  });

  /** The whole point: no scrollbar of its own, so a capped list inside can own its scroll. */
  it('gives the body min-h-0 flex-1 and no overflow class of its own', () => {
    const { container } = render(
      <PaneFrame header={<h1>Paper builder</h1>}>
        <p>body</p>
      </PaneFrame>,
    );

    const body = screen.getByText('body').parentElement;
    assert.ok(body?.className.includes('min-h-0'));
    assert.ok(body?.className.includes('flex-1'));
    assert.equal(container.querySelectorAll('.overflow-y-auto').length, 0);
    assert.equal(container.querySelectorAll('[class*="overflow-"]').length, 0);
  });

  it('renders without a header at all', () => {
    render(
      <PaneFrame>
        <p>body</p>
      </PaneFrame>,
    );

    assert.ok(screen.getByText('body'));
  });

  /** The frame owns the height here, so a paging list must not also cap itself half way down it. */
  it('lets a paging table fill the pane instead of capping', () => {
    render(
      <PaneFrame>
        <DataTable
          columns={[{ key: 'name', header: 'Name', cell: () => 'Alpha' }]}
          rows={[{ id: 'a' }]}
          rowKey={(row) => row.id}
          isLoading={false}
          empty="none"
          scroll={{ hasMore: true }}
        />
      </PaneFrame>,
    );

    const scroller = screen.getByRole('table').parentElement;
    assert.match(scroller?.className ?? '', /flex-1/);
    assert.ok(!scroller?.className.includes('max-h-'));
  });
});
