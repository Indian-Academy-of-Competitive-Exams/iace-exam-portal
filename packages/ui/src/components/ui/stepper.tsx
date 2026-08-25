import { Check } from 'lucide-react';
import { cn } from '../../lib/utils';

/** The phase strip for a form walked in steps. Sits outside the `fieldset` that would disable it. */

export const STEPPER_STATES = { DONE: 'done', CURRENT: 'current', TODO: 'todo' } as const;
export type StepperState = (typeof STEPPER_STATES)[keyof typeof STEPPER_STATES];

export interface StepperStep {
  value: string;
  label: string;
  state: StepperState;
  /** Nothing to write against yet — the record this step edits does not exist. */
  disabled?: boolean;
}

export interface StepperProps {
  steps: readonly StepperStep[];
  onValueChange: (value: string) => void;
  /** The strip's accessible name. */
  label?: string;
  className?: string;
}

const MARK: Readonly<Record<StepperState, string>> = {
  [STEPPER_STATES.DONE]: 'border-primary/25 bg-primary/10 text-primary',
  [STEPPER_STATES.CURRENT]: 'border-primary bg-primary text-primary-foreground',
  [STEPPER_STATES.TODO]: 'border-border text-muted-foreground',
};

const TEXT: Readonly<Record<StepperState, string>> = {
  [STEPPER_STATES.DONE]: 'text-foreground',
  [STEPPER_STATES.CURRENT]: 'text-foreground',
  [STEPPER_STATES.TODO]: 'text-muted-foreground',
};

const SHARED = 'inline-flex items-center gap-2 whitespace-nowrap rounded-md px-2 py-1';

export function Stepper({
  steps,
  onValueChange,
  label = 'Steps',
  className,
}: Readonly<StepperProps>) {
  return (
    <nav aria-label={label} className={className}>
      <ol className="flex flex-wrap items-center gap-1">
        {steps.map((step, index) => (
          <li key={step.value} className="flex items-center gap-1">
            <Step step={step} index={index} onSelect={onValueChange} />
            {index < steps.length - 1 ? (
              <span aria-hidden className="hidden h-px w-6 bg-border sm:block" />
            ) : null}
          </li>
        ))}
      </ol>
    </nav>
  );
}

function Step({
  step,
  index,
  onSelect,
}: Readonly<{ step: StepperStep; index: number; onSelect: (value: string) => void }>) {
  const current = step.state === STEPPER_STATES.CURRENT ? 'step' : undefined;
  const body = (
    <>
      <span
        className={cn(
          'flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold [&_svg]:size-3.5',
          MARK[step.state],
        )}
      >
        {step.state === STEPPER_STATES.DONE ? <Check aria-hidden /> : index + 1}
      </span>
      <span className={cn('text-sm font-medium', TEXT[step.state])}>{step.label}</span>
    </>
  );

  if (step.disabled) {
    return (
      <span aria-current={current} className={cn(SHARED, 'opacity-50')}>
        {body}
      </span>
    );
  }

  return (
    <button
      type="button"
      aria-current={current}
      onClick={() => onSelect(step.value)}
      className={cn(
        SHARED,
        'transition-colors hover:bg-muted focus-visible:shadow-focus focus-visible:outline-none',
      )}
    >
      {body}
    </button>
  );
}
