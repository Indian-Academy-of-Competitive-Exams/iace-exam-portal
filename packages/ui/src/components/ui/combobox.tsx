import * as React from 'react';
import { ComboboxOption, ComboboxShell, type ComboboxListProps } from './combobox-shell';

export type { ComboboxItem } from './combobox-shell';

export interface ComboboxProps extends ComboboxListProps {
  value: string;
  onChange: (value: string) => void;

  /** Label for the current value when it sits outside the loaded pages. */
  selectedLabel?: string;

  /** Omit to make the control mandatory — no way back to "no choice". */
  clearable?: boolean;
}

/**
 * Select for a list too long to render at once; the next page loads near the bottom.
 * Paging itself lives in `useInfinitePages` (@iace/app-kit).
 */
export function Combobox({
  value,
  onChange,
  selectedLabel,
  clearable = true,
  ...list
}: Readonly<ComboboxProps>) {
  const [open, setOpen] = React.useState(false);
  const placeholder = list.placeholder ?? 'Choose…';

  const selected = list.items.find((item) => item.value === value);
  const chosen = selected?.label ?? selectedLabel ?? (value || null);

  return (
    <ComboboxShell
      {...list}
      open={open}
      onOpenChange={setOpen}
      triggerLabel={chosen ?? placeholder}
      triggerMuted={chosen === null}
    >
      {clearable ? (
        <ComboboxOption
          label={placeholder}
          muted
          selected={value === ''}
          onSelect={() => {
            onChange('');
            setOpen(false);
          }}
        />
      ) : null}

      {list.items.map((item) => (
        <ComboboxOption
          key={item.value}
          label={item.label}
          hint={item.hint}
          selected={item.value === value}
          onSelect={() => {
            onChange(item.value);
            setOpen(false);
          }}
        />
      ))}
    </ComboboxShell>
  );
}
