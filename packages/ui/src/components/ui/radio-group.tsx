import * as React from 'react';
import { cn } from '../../lib/utils';

interface RadioGroupContextValue {
  name: string;
  value?: string;
  onValueChange?: (value: string) => void;
  disabled?: boolean;
}

const RadioGroupContext = React.createContext<RadioGroupContextValue | null>(null);

export interface RadioGroupProps extends Omit<
  React.HTMLAttributes<HTMLFieldSetElement>,
  'onChange'
> {
  /**
   * Shared by every radio in the group. It is what makes them one control
   * rather than four unrelated ones — the browser keys the arrow-key roving,
   * the single-selection rule and "radio button, 2 of 4" off this name.
   */
  name: string;
  value?: string;
  onValueChange?: (value: string) => void;
  disabled?: boolean;
  /**
   * What the group is asking. Required, because a set of options with no
   * question announces four unexplained choices — for a CBT paper it is the
   * question stem.
   */
  legend: React.ReactNode;
  /** The stem is already on screen above the options, so it is not repeated. */
  hideLegend?: boolean;
}

/**
 * One choice out of several.
 *
 * Native radios, for the same reason Checkbox uses a native box: the browser's
 * own control already moves between options with the arrow keys, enforces the
 * one-of-many rule, and announces its position in the set. A div wearing a
 * radio role has to re-earn all three, and the exam screen is the last place to
 * be relying on a re-implementation of something the platform does.
 *
 * A `fieldset` with a `legend` rather than a div, because that is the element
 * that ties a question to its answers: without it a screen reader reads four
 * options with nothing saying what they answer.
 */
export function RadioGroup({
  name,
  value,
  onValueChange,
  disabled,
  legend,
  hideLegend = false,
  className,
  children,
  ...props
}: Readonly<RadioGroupProps>) {
  const context = React.useMemo(
    () => ({ name, value, onValueChange, disabled }),
    [name, value, onValueChange, disabled],
  );

  return (
    <fieldset className={cn('flex flex-col gap-1', className)} disabled={disabled} {...props}>
      <legend className={cn('mb-1 text-sm font-medium text-foreground', hideLegend && 'sr-only')}>
        {legend}
      </legend>
      <RadioGroupContext.Provider value={context}>{children}</RadioGroupContext.Provider>
    </fieldset>
  );
}

export interface RadioGroupItemProps extends Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  'type' | 'name' | 'value'
> {
  value: string;
  label: React.ReactNode;
  hint?: React.ReactNode;
}

/**
 * Shaped like Checkbox on purpose — the two sit in the same forms, and a radio
 * row that is a different height from a checkbox row above it reads as a
 * mistake rather than as a different kind of question.
 */
export const RadioGroupItem = React.forwardRef<HTMLInputElement, RadioGroupItemProps>(
  ({ className, value, label, hint, id, onChange, ...props }, ref) => {
    const group = React.useContext(RadioGroupContext);
    if (!group) throw new Error('RadioGroupItem must be rendered inside a RadioGroup');

    return (
      <label
        htmlFor={id}
        className={cn(
          'flex cursor-pointer items-start gap-2.5 rounded-md px-2 py-1.5 transition-colors hover:bg-muted/60',
          'has-[input:disabled]:cursor-not-allowed has-[input:disabled]:opacity-50',
          'has-[input:checked]:bg-primary-subtle',
          className,
        )}
      >
        <input
          ref={ref}
          id={id}
          type="radio"
          name={group.name}
          value={value}
          // Uncontrolled when the group has no `value` — a form using
          // react-hook-form registers the inputs itself and owns the state.
          checked={group.value === undefined ? undefined : group.value === value}
          className="mt-0.5 size-4 shrink-0 accent-primary focus-visible:shadow-focus focus-visible:outline-none"
          onChange={(event) => {
            onChange?.(event);
            if (event.target.checked) group.onValueChange?.(value);
          }}
          {...props}
        />
        <span className="text-sm leading-tight text-foreground">
          {label}
          {hint ? <span className="mt-0.5 block text-xs text-muted-foreground">{hint}</span> : null}
        </span>
      </label>
    );
  },
);
RadioGroupItem.displayName = 'RadioGroupItem';
