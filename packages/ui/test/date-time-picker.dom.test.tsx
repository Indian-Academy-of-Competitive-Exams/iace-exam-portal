import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import * as React from 'react';
import { DateTimePicker } from '../src/components/ui/date-time-picker';

afterEach(cleanup);

function Harness({ initial = '' }: Readonly<{ initial?: string }>) {
  const [value, setValue] = React.useState(initial);
  return (
    <>
      <DateTimePicker aria-label="Opens" value={value} onChange={setValue} />
      <p data-testid="value">{value}</p>
    </>
  );
}

const held = () => screen.getByTestId('value').textContent ?? '';
const timeField = () => screen.getByLabelText('Opens time');

describe('DateTimePicker', () => {
  it('reads a wall time back into its two halves', () => {
    render(<Harness initial="2026-09-01T10:00" />);

    assert.equal((timeField() as HTMLInputElement).value, '10:00');
    assert.equal(screen.getByLabelText('Opens').textContent?.includes('2026'), true);
  });

  it('keeps the day when only the time changes', () => {
    render(<Harness initial="2026-09-01T10:00" />);

    fireEvent.change(timeField(), { target: { value: '14:30' } });

    assert.equal(held(), '2026-09-01T14:30');
  });

  /** The failure this prevents: half a value read as midnight nobody chose. */
  it('holds nothing at all until both halves are there', () => {
    render(<Harness initial="2026-09-01T10:00" />);

    fireEvent.change(timeField(), { target: { value: '' } });

    assert.equal(held(), '');
  });

  it('has no time to set before a day is chosen', () => {
    render(<Harness />);

    assert.equal((timeField() as HTMLInputElement).disabled, true);
  });
});
