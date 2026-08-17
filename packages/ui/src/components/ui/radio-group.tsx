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
  /** Shared by every radio in the group — the browser keys arrow-key roving off it. */
  name: string;
  value?: string;
  onValueChange?: (value: string) => void;
  disabled?: boolean;
  /** What the group is asking. For a CBT paper it is the question stem. */
  legend: React.ReactNode;
  /** The stem is already on screen above the options, so it is not repeated. */
  hideLegend?: boolean;
}

/**
 * Native radios: arrow keys, the one-of-many rule and "radio button, 2 of 4" come free.
 * A `fieldset` + `legend` is what ties the question to its answers.
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

/** Same row shape as Checkbox — the two sit in the same forms. */
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
          // Uncontrolled when the group has no `value`: react-hook-form owns it.
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
