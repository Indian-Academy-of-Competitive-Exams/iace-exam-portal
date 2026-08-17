import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { useForm } from 'react-hook-form';
import { cleanup, render, screen } from '@testing-library/react';
import { Progress } from '../src/components/ui/progress';
import { Spinner, LoadingState } from '../src/components/ui/spinner';
import { Skeleton, SkeletonParagraph } from '../src/components/ui/skeleton';
import { Separator } from '../src/components/ui/separator';
import { StatRow } from '../src/components/ui/stat-row';
import { StepIcon } from '../src/components/ui/step-icon';
import { PinField } from '../src/components/ui/pin-field';

afterEach(cleanup);

describe('Progress', () => {
  it('reports its value as a progress bar', () => {
    render(<Progress aria-label="Import progress" value={42} max={100} />);
    const bar = screen.getByRole('progressbar', { name: 'Import progress' });

    assert.equal(bar.tagName, 'PROGRESS');
    assert.equal((bar as HTMLProgressElement).value, 42);
  });

  /** No value is the indeterminate state, which is honest about not knowing. */
  it('is indeterminate with no value', () => {
    render(<Progress aria-label="Working" />);

    assert.equal(screen.getByRole('progressbar').getAttribute('value'), null);
  });
});

describe('Spinner', () => {
  /** Marking both the glyph and the text beside it announces the wait twice. */
  it('announces itself only when it carries a label', () => {
    const { rerender } = render(<Spinner label="Loading" />);
    assert.ok(screen.getByRole('status', { name: 'Loading' }));

    rerender(<Spinner />);
    assert.equal(screen.queryByRole('status'), null);
  });

  it('LoadingState puts the announcement on the text', () => {
    render(<LoadingState>Reading the file…</LoadingState>);

    assert.equal(screen.getByRole('status').textContent, 'Reading the file…');
  });

  it('LoadingState has a default for the ordinary case', () => {
    render(<LoadingState />);

    assert.equal(screen.getByRole('status').textContent, 'Loading…');
  });
});

describe('Skeleton', () => {
  /** A placeholder is scenery: a screen reader should hear the wait once, elsewhere. */
  it('is hidden from assistive tech', () => {
    const { container } = render(<Skeleton variant="row" />);

    assert.equal(container.firstElementChild?.getAttribute('aria-hidden'), 'true');
  });

  it('draws the paragraph it was asked for, ending short', () => {
    const { container } = render(<SkeletonParagraph lines={4} />);
    const lines = [...(container.firstElementChild?.children ?? [])];

    assert.equal(lines.length, 4);
    assert.ok(lines.at(-1)?.className.includes('w-[62%]'));
    assert.ok(!lines[0]?.className.includes('w-[62%]'));
  });
});

describe('Separator', () => {
  /** A reader hearing "separator" between every row gets noise a sighted one does not. */
  it('is silent when decorative, and announced when it is not', () => {
    const { container, rerender } = render(<Separator />);
    assert.equal(container.firstElementChild?.getAttribute('role'), null);

    rerender(<Separator decorative={false} orientation="vertical" />);
    const rule = screen.getByRole('separator');
    assert.equal(rule.getAttribute('aria-orientation'), 'vertical');
  });
});

describe('StatRow', () => {
  it('shows the label beside its number', () => {
    render(<StatRow label="Rows read" value={1858} />);

    assert.ok(screen.getByText('Rows read'));
    assert.ok(screen.getByText('1858'));
  });
});

describe('StepIcon', () => {
  /** The heading under it names the step; announcing the glyph says it twice. */
  it('is decorative', () => {
    const Mail = (props: Record<string, unknown>) => <svg {...props} />;
    const { container } = render(<StepIcon icon={Mail as never} />);

    assert.equal(container.querySelector('svg')?.getAttribute('aria-hidden'), 'true');
  });
});

describe('PinField', () => {
  function Form() {
    const form = useForm<{ code: string }>({ defaultValues: { code: '' } });
    return <PinField form={form} name="code" label="One-time code" length={4} />;
  }

  /**
   * One real input under the drawn boxes — that is what makes autofill and paste
   * work, and what `FormField` cannot give a control that renders its own value.
   */
  it('labels the single field that holds the whole code', () => {
    render(<Form />);

    const field = screen.getByLabelText('One-time code');
    assert.equal(field.tagName, 'INPUT');
    assert.equal(screen.getAllByRole('textbox').length, 1);
  });
});
