import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { cleanup, render, screen } from '@testing-library/react';
import { RadioGroup, RadioGroupItem } from '../src/components/ui/radio-group';

afterEach(cleanup);

const options = ['4813', '4831', '8134', '1348'];

function Question(props: Readonly<{ value?: string; onValueChange?: (v: string) => void }>) {
  return (
    <RadioGroup name="q1" legend="What is 4813?" {...props}>
      {options.map((option) => (
        <RadioGroupItem key={option} id={`q1-${option}`} value={option} label={option} />
      ))}
    </RadioGroup>
  );
}

describe('RadioGroup', () => {
  /** A fieldset+legend is what ties the question to its answers. */
  it('exposes the legend as the group name', () => {
    render(<Question />);

    assert.equal(screen.getByRole('group', { name: 'What is 4813?' }).tagName, 'FIELDSET');
  });

  it('keeps the legend for a screen reader when it is visually hidden', () => {
    render(
      <RadioGroup name="q2" legend="Pick one" hideLegend>
        <RadioGroupItem id="q2-a" value="a" label="A" />
      </RadioGroup>,
    );

    assert.ok(screen.getByRole('group', { name: 'Pick one' }));
  });

  /** The shared name is what makes them one control to the browser. */
  it('gives every option the group name, and radio semantics', () => {
    render(<Question />);
    const radios = screen.getAllByRole('radio') as HTMLInputElement[];

    assert.equal(radios.length, 4);
    assert.deepEqual([...new Set(radios.map((r) => r.name))], ['q1']);
  });

  it('reports the value that was chosen', () => {
    const onValueChange = mock.fn();
    render(<Question onValueChange={onValueChange} />);

    screen.getByRole('radio', { name: '8134' }).click();

    assert.deepEqual(onValueChange.mock.calls[0]?.arguments, ['8134']);
  });

  /**
   * `checked={false}` would pin every option unchecked, so a form that registers
   * the inputs itself could never tick one.
   */
  it('is uncontrolled when the group holds no value', () => {
    render(<Question />);
    const option = screen.getByRole('radio', { name: '4831' }) as HTMLInputElement;

    option.click();

    assert.equal(option.checked, true);
  });

  it('reflects a controlled value, and only that one', () => {
    render(<Question value="1348" onValueChange={() => {}} />);
    const radios = screen.getAllByRole('radio') as HTMLInputElement[];

    assert.deepEqual(
      radios.map((r) => r.checked),
      [false, false, false, true],
    );
  });

  /**
   * Disabling is the fieldset's job, which is the native mechanism — an input's
   * own `disabled` property stays false while its fieldset makes it inert.
   */
  it('disables the whole group through the fieldset', () => {
    const onValueChange = mock.fn();
    render(
      <RadioGroup name="q3" legend="Locked" disabled onValueChange={onValueChange}>
        <RadioGroupItem id="q3-a" value="a" label="A" />
      </RadioGroup>,
    );

    const group = screen.getByRole('group', { name: 'Locked' }) as HTMLFieldSetElement;
    assert.equal(group.disabled, true);

    screen.getByRole('radio', { name: 'A' }).click();
    assert.equal(onValueChange.mock.callCount(), 0);
  });

  it('refuses to render outside a group', () => {
    assert.throws(
      () => render(<RadioGroupItem id="loose" value="a" label="A" />),
      /must be rendered inside a RadioGroup/,
    );
  });
});

/** A filter bar puts the label and the choices on one line; a fieldset's legend cannot do that. */
describe('RadioGroup — inline', () => {
  it('names the group from a label sitting in the same row', () => {
    render(
      <RadioGroup inline name="match" legend="Match filters" value="all">
        <RadioGroupItem value="all" label="All" />
        <RadioGroupItem value="any" label="Any" />
      </RadioGroup>,
    );

    const group = screen.getByRole('radiogroup', { name: 'Match filters' });
    assert.equal(group.tagName, 'DIV');
    assert.ok(screen.getByRole('radio', { name: 'All' }));
  });

  it('still disables every radio when the group is disabled', () => {
    render(
      <RadioGroup inline disabled name="match" legend="Match filters" value="all">
        <RadioGroupItem value="all" label="All" />
      </RadioGroup>,
    );

    assert.equal((screen.getByRole('radio', { name: 'All' }) as HTMLInputElement).disabled, true);
  });
});
