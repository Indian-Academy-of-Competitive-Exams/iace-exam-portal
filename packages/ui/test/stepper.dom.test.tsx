import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Stepper, STEPPER_STATES, type StepperStep } from '../src/components/ui/stepper';

afterEach(cleanup);

const STEPS: StepperStep[] = [
  { value: 'blueprint', label: 'Blueprint', state: STEPPER_STATES.DONE },
  { value: 'rules', label: 'Rules', state: STEPPER_STATES.CURRENT },
  { value: 'paper', label: 'Paper', state: STEPPER_STATES.TODO },
];

describe('Stepper', () => {
  it('opens the step that was chosen', () => {
    const onValueChange = mock.fn();
    render(<Stepper steps={STEPS} onValueChange={onValueChange} />);

    fireEvent.click(screen.getByRole('button', { name: /Paper/ }));

    assert.deepEqual(onValueChange.mock.calls[0]?.arguments, ['paper']);
  });

  /** Which phase you are reading is the one thing the strip has to say out loud. */
  it('marks the open step for a reader who cannot see the fill', () => {
    render(<Stepper steps={STEPS} onValueChange={mock.fn()} />);

    assert.equal(
      screen.getByRole('button', { name: /Rules/ }).getAttribute('aria-current'),
      'step',
    );
    assert.equal(screen.getByRole('button', { name: /Paper/ }).getAttribute('aria-current'), null);
  });

  /** The failure this prevents: reaching a step before the record it writes against exists. */
  it('leaves a step with nothing to write against out of reach', () => {
    const onValueChange = mock.fn();
    const locked = STEPS.map((step) => ({ ...step, disabled: step.value !== 'blueprint' }));
    render(<Stepper steps={locked} onValueChange={onValueChange} />);

    assert.equal(screen.queryByRole('button', { name: /Paper/ }), null);
    assert.equal(screen.getAllByRole('button').length, 1);

    fireEvent.click(screen.getByText('Paper'));
    assert.equal(onValueChange.mock.callCount(), 0);
  });
});
