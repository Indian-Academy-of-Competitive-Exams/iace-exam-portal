import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Input } from '../src/components/ui/input';

afterEach(cleanup);

const SUGGESTION = 'SSC CGL Tier 1 Standard — Mock 05';

describe('Input suggestion', () => {
  it('offers the suggestion where an empty field shows its placeholder', () => {
    render(<Input suggestion={SUGGESTION} placeholder="ignored while one is offered" />);

    assert.equal(screen.getByRole('textbox').getAttribute('placeholder'), SUGGESTION);
  });

  it('keeps its own placeholder when there is nothing to suggest', () => {
    render(<Input placeholder="SSC CGL Tier 1 — Mock 1" />);

    assert.equal(
      screen.getByRole('textbox').getAttribute('placeholder'),
      'SSC CGL Tier 1 — Mock 1',
    );
    assert.equal(screen.queryByRole('button'), null);
  });

  it('takes the suggestion on Tab', () => {
    const onAcceptSuggestion = mock.fn();
    render(<Input suggestion={SUGGESTION} onAcceptSuggestion={onAcceptSuggestion} />);

    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Tab' });

    assert.deepEqual(onAcceptSuggestion.mock.calls[0]?.arguments, [SUGGESTION]);
  });

  /** The failure this prevents: a keyboard user caught on a field they cannot Tab out of. */
  it('leaves Tab alone once there is nothing on offer', () => {
    const onKeyDown = mock.fn();
    render(<Input onKeyDown={onKeyDown} />);

    const moved = fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Tab' });

    assert.equal(moved, true);
    assert.equal(onKeyDown.mock.callCount(), 1);
  });

  it('leaves Shift+Tab alone, which is going backwards rather than accepting', () => {
    const onAcceptSuggestion = mock.fn();
    render(<Input suggestion={SUGGESTION} onAcceptSuggestion={onAcceptSuggestion} />);

    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Tab', shiftKey: true });

    assert.equal(onAcceptSuggestion.mock.callCount(), 0);
  });

  /** A mouse never presses Tab, so the hint has to be a real control and has to say what it does. */
  it('takes the suggestion from a click, naming it for a reader who cannot see the field', () => {
    const onAcceptSuggestion = mock.fn();
    render(<Input suggestion={SUGGESTION} onAcceptSuggestion={onAcceptSuggestion} />);

    fireEvent.click(screen.getByRole('button', { name: `Use the suggested name ${SUGGESTION}` }));

    assert.deepEqual(onAcceptSuggestion.mock.calls[0]?.arguments, [SUGGESTION]);
  });

  it('offers nothing at all while the field is disabled', () => {
    const onAcceptSuggestion = mock.fn();
    render(<Input disabled suggestion={SUGGESTION} onAcceptSuggestion={onAcceptSuggestion} />);

    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Tab' });

    assert.equal(screen.queryByRole('button'), null);
    assert.equal(onAcceptSuggestion.mock.callCount(), 0);
  });
});
