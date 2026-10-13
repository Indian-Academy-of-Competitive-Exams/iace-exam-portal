import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { TypingPane } from '../src/features/typing/typing-pane';

afterEach(cleanup);

function Harness({ backspace }: Readonly<{ backspace: boolean }>) {
  const [typed, setTyped] = useState('the quick');
  return (
    <TypingPane
      passage="the quick brown fox"
      value={typed}
      onChange={setTyped}
      backspace={backspace}
    />
  );
}

const box = () => screen.getByLabelText<HTMLTextAreaElement>('Type the passage here');
const type = (value: string) => fireEvent.change(box(), { target: { value } });

describe('TypingPane', () => {
  it('refuses a paste, a drop and a copy of the passage', () => {
    render(<Harness backspace />);

    assert.equal(fireEvent.paste(box()), false);
    assert.equal(fireEvent.drop(box()), false);
    assert.equal(fireEvent.copy(screen.getByLabelText('Passage')), false);
  });

  it('keeps only what extends the text where the board allows no correction', () => {
    render(<Harness backspace={false} />);

    assert.equal(fireEvent.keyDown(box(), { key: 'Backspace' }), false);
    type('the quic');
    assert.equal(box().value, 'the quick');
    type('the quick brown');
    assert.equal(box().value, 'the quick brown');
  });

  it('lets a mistake be corrected where backspace is allowed', () => {
    render(<Harness backspace />);

    assert.equal(fireEvent.keyDown(box(), { key: 'Backspace' }), true);
    type('the quic');
    assert.equal(box().value, 'the quic');
  });

  it('counts key depressions as the evaluator will', () => {
    render(<Harness backspace />);

    type('the  quick\nbrown ');

    assert.ok(screen.getByText('15'));
  });
});
