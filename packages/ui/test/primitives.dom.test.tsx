import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { useForm } from 'react-hook-form';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Alert } from '../src/components/ui/alert';
import { Progress } from '../src/components/ui/progress';
import { Spinner, LoadingState } from '../src/components/ui/spinner';
import { Skeleton, SkeletonParagraph } from '../src/components/ui/skeleton';
import { Separator } from '../src/components/ui/separator';
import { Brandmark } from '../src/components/ui/brandmark';
import { StatRow } from '../src/components/ui/stat-row';
import { StepIcon } from '../src/components/ui/step-icon';
import { PinField } from '../src/components/ui/pin-field';
import { Metric } from '../src/components/ui/metric';
import { MetricGroup } from '../src/components/ui/metric-group';
import { Inbox } from 'lucide-react';
import { EmptyState } from '../src/components/ui/empty-state';
import { SectionHeading } from '../src/components/ui/section-heading';
import { PageHeader } from '../src/components/ui/page-header';

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

describe('Brandmark', () => {
  /**
   * The institute is IACE. A mark that renders an abbreviation, or repeats the
   * name for a screen reader, reads as a bug in the logo.
   */
  it('says the institute name once, in full', () => {
    const { container } = render(<Brandmark />);

    assert.equal(container.textContent, 'IACE');
  });

  it('names the portal only when given one', () => {
    const { container, rerender } = render(<Brandmark portal="Admin" />);
    assert.ok(screen.getByText('Admin'));

    rerender(<Brandmark />);
    assert.equal(container.textContent, 'IACE');
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

describe('Metric', () => {
  it('shows the label, the number and the unit that qualifies it', () => {
    render(<Metric label="Marks" value={45} unit="/ 100" />);

    assert.ok(screen.getByText('Marks'));
    assert.ok(screen.getByText('45'));
    assert.ok(screen.getByText('/ 100'));
  });

  it('renders the value it was given when there is no number to show', () => {
    render(<Metric label="Rank" value="—" />);

    assert.ok(screen.getByText('Rank'));
    assert.ok(screen.getByText('—'));
  });
});

describe('MetricGroup', () => {
  it('renders every metric it was given', () => {
    render(
      <MetricGroup>
        <Metric label="Marks" value={45} />
        <Metric label="Rank" value={12} />
      </MetricGroup>,
    );

    assert.ok(screen.getByText('Marks'));
    assert.ok(screen.getByText('Rank'));
  });
});

describe('EmptyState', () => {
  it('names what is absent and carries the way out of it', () => {
    render(
      <EmptyState
        icon={Inbox}
        title="No tests yet"
        action={<button type="button">Browse</button>}
      />,
    );

    assert.ok(screen.getByRole('heading', { name: 'No tests yet' }));
    assert.ok(screen.getByRole('button', { name: 'Browse' }));
  });

  it('renders no hint paragraph when it was given no hint', () => {
    const { container } = render(<EmptyState icon={Inbox} title="No tests yet" />);

    assert.ok(screen.getByRole('heading', { name: 'No tests yet' }));
    assert.equal(container.querySelectorAll('p').length, 0);
  });

  it('carries the hint when there is a rule the reader cannot infer', () => {
    render(
      <EmptyState icon={Inbox} title="No tests yet" hint="Your branch adds them as they open." />,
    );

    assert.ok(screen.getByText('Your branch adds them as they open.'));
  });

  it('drops a level where it sits under another heading', () => {
    render(<EmptyState icon={Inbox} title="Nothing waiting" level={3} />);

    assert.ok(screen.getByRole('heading', { level: 3, name: 'Nothing waiting' }));
  });
});

describe('SectionHeading', () => {
  it('is a second-level heading by default, and takes a value beside it', () => {
    render(<SectionHeading title="Sections" meta="4 sections" />);

    assert.ok(screen.getByRole('heading', { level: 2, name: 'Sections' }));
    assert.ok(screen.getByText('4 sections'));
  });

  it('drops a level where it sits under another heading', () => {
    render(<SectionHeading title="Solution" level={3} />);

    assert.ok(screen.getByRole('heading', { level: 3, name: 'Solution' }));
  });
});

describe('PageHeader', () => {
  it('titles the page at one level, whatever size it is set at', () => {
    render(<PageHeader title="Performance" size="display" />);

    assert.ok(screen.getByRole('heading', { level: 1, name: 'Performance' }));
  });
});

describe('Alert', () => {
  it('lets a reader put away a notice they have read', () => {
    render(
      <Alert variant="info" dismissible>
        This standing can still move.
      </Alert>,
    );

    assert.ok(screen.getByText('This standing can still move.'));
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));

    assert.equal(screen.queryByText('This standing can still move.'), null);
  });

  /** The failure this prevents: waving away the one variant that reports something wrong. */
  it('gives a danger alert no way to be dismissed', () => {
    render(
      <Alert variant="danger" dismissible>
        Your performance did not load.
      </Alert>,
    );

    assert.ok(screen.getByText('Your performance did not load.'));
    assert.equal(screen.queryByRole('button', { name: 'Dismiss' }), null);
  });

  it('stays where nobody asked for a way to close it', () => {
    render(<Alert variant="info">A fact they could not infer.</Alert>);

    assert.equal(screen.queryByRole('button', { name: 'Dismiss' }), null);
  });
});

describe('Separator — dashed', () => {
  /** A filled div has nothing to leave gaps in, so a dash has to come from a border. */
  it('draws a dash with a border rather than a fill', () => {
    const { container } = render(<Separator orientation="vertical" dashed />);

    const rule = container.firstElementChild;
    assert.ok(rule?.className.includes('border-dashed'));
    assert.ok(rule?.className.includes('border-l'));
    assert.equal(rule?.className.includes('bg-border'), false);
    // THE failure this prevents: h-full beats align-self, so a rule in a flex row draws nothing.
    assert.ok(rule?.className.includes('self-stretch'));
    assert.equal(rule?.className.includes('h-full'), false);
  });

  it('still fills when it is not dashed', () => {
    const { container } = render(<Separator orientation="vertical" />);

    assert.ok(container.firstElementChild?.className.includes('bg-border'));
  });
});
