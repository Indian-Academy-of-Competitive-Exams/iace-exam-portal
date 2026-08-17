import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { SearchInput } from '../src/components/ui/search-input';

afterEach(cleanup);

const box = () => screen.getByRole('searchbox', { name: 'Search students' });

function type(text: string) {
  fireEvent.change(box(), { target: { value: text } });
}

describe('SearchInput', () => {
  /** Eight keystrokes were eight requests, and eight history entries. */
  it('does not report a keystroke until the typing settles', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const onChange = mock.fn();
    render(<SearchInput aria-label="Search students" value="" onChange={onChange} />);

    for (const term of ['A', 'AM', 'AME', 'AMEE']) {
      type(term);
      t.mock.timers.tick(50);
    }
    assert.equal(onChange.mock.callCount(), 0);

    t.mock.timers.tick(300);
    assert.equal(onChange.mock.callCount(), 1);
    assert.deepEqual(onChange.mock.calls[0]?.arguments, ['AMEE']);
  });

  it('keeps the box instant while the search waits', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    render(<SearchInput aria-label="Search students" value="" onChange={() => {}} />);

    type('AMEE');

    assert.equal((box() as HTMLInputElement).value, 'AMEE');
  });

  it('Enter reports it now, and only once', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const onChange = mock.fn();
    render(<SearchInput aria-label="Search students" value="" onChange={onChange} />);

    type('RAVI');
    fireEvent.keyDown(box(), { key: 'Enter' });

    assert.deepEqual(onChange.mock.calls[0]?.arguments, ['RAVI']);
    t.mock.timers.tick(1000);
    assert.equal(onChange.mock.callCount(), 1);
  });

  it('losing focus reports it too', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const onChange = mock.fn();
    render(<SearchInput aria-label="Search students" value="" onChange={onChange} />);

    type('RAVI');
    fireEvent.blur(box());

    assert.deepEqual(onChange.mock.calls[0]?.arguments, ['RAVI']);
  });

  it('clears the box and the search in one click', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const onChange = mock.fn();
    render(<SearchInput aria-label="Search students" value="RAVI" onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));

    assert.equal((box() as HTMLInputElement).value, '');
    assert.deepEqual(onChange.mock.calls[0]?.arguments, ['']);
  });

  it('offers no clear button while the box is empty', () => {
    render(<SearchInput aria-label="Search students" value="" onChange={() => {}} />);

    assert.equal(screen.queryByRole('button', { name: 'Clear search' }), null);
  });

  /** A "clear all filters" elsewhere on the screen must empty the box. */
  it('follows the value when it changes from outside', () => {
    const { rerender } = render(
      <SearchInput aria-label="Search students" value="RAVI" onChange={() => {}} />,
    );
    assert.equal((box() as HTMLInputElement).value, 'RAVI');

    rerender(<SearchInput aria-label="Search students" value="" onChange={() => {}} />);

    assert.equal((box() as HTMLInputElement).value, '');
  });

  /** The caret must not jump back while somebody is still typing. */
  it('ignores the echo of its own commit', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const { rerender } = render(
      <SearchInput aria-label="Search students" value="" onChange={() => {}} />,
    );

    type('RAV');
    t.mock.timers.tick(300);
    rerender(<SearchInput aria-label="Search students" value="RAV" onChange={() => {}} />);
    type('RAVI');

    assert.equal((box() as HTMLInputElement).value, 'RAVI');
  });
});
