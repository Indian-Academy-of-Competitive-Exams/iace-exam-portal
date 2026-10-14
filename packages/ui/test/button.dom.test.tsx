import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { cleanup, render, screen } from '@testing-library/react';
import { Button } from '../src/components/ui/button';

afterEach(cleanup);

describe('Button loading', () => {
  /** A spinner does not stop a second click; `disabled` is the only thing that does. */
  it('disables even when the caller passed disabled={false}', () => {
    render(
      <Button loading disabled={false}>
        Save
      </Button>,
    );

    assert.equal((screen.getByRole('button') as HTMLButtonElement).disabled, true);
  });

  it('announces itself busy, and stops when it is not', () => {
    const { rerender } = render(<Button loading>Save</Button>);
    assert.equal(screen.getByRole('button').getAttribute('aria-busy'), 'true');

    rerender(<Button>Save</Button>);
    assert.equal(screen.getByRole('button').getAttribute('aria-busy'), null);
  });

  /** One slot: a running button must not claim the action started twice. */
  it('swaps the icon for the spinner rather than showing both', () => {
    const { rerender } = render(<Button icon={<svg data-testid="icon" />}>Deactivate</Button>);
    assert.ok(screen.getByTestId('icon'));

    rerender(
      <Button loading icon={<svg data-testid="icon" />}>
        Deactivate
      </Button>,
    );
    assert.equal(screen.queryByTestId('icon'), null);
    assert.equal(screen.getByRole('button').querySelectorAll('svg').length, 1);
  });

  it('does not fire while loading', () => {
    const onClick = mock.fn();
    render(
      <Button loading onClick={onClick}>
        Save
      </Button>,
    );

    screen.getByRole('button').click();

    assert.equal(onClick.mock.callCount(), 0);
  });
});

describe('Button type', () => {
  /** A bare <button> submits the form it stands in. */
  it('defaults to type=button', () => {
    render(<Button>Open</Button>);
    assert.equal(screen.getByRole('button').getAttribute('type'), 'button');
  });

  it('does not submit a form it is standing in', () => {
    const onSubmit = mock.fn((event: React.FormEvent) => event.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <Button>Open a panel</Button>
      </form>,
    );

    screen.getByRole('button').click();

    assert.equal(onSubmit.mock.callCount(), 0);
  });

  it('still submits when asked to', () => {
    const onSubmit = mock.fn((event: React.FormEvent) => event.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <Button type="submit">Save</Button>
      </form>,
    );

    screen.getByRole('button').click();

    assert.equal(onSubmit.mock.callCount(), 1);
  });

  /** A Slot takes exactly one child, so nothing may be injected into it. */
  it('renders the child element under asChild, with no type attribute', () => {
    render(
      <Button asChild>
        <a href="/students">All students</a>
      </Button>,
    );

    const link = screen.getByRole('link', { name: 'All students' });
    assert.equal(link.tagName, 'A');
    assert.equal(link.getAttribute('type'), null);
  });
});
