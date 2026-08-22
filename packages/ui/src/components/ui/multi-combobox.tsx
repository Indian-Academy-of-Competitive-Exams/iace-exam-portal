import * as React from 'react';
import { X } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Badge } from './badge';
import { ComboboxOption, ComboboxShell, type ComboboxListProps } from './combobox-shell';

export interface MultiComboboxProps extends ComboboxListProps {
  value: readonly string[];
  onChange: (next: string[]) => void;

  /** Labels for values sitting outside the loaded pages, keyed by value. */
  selectedLabels?: Readonly<Record<string, string>>;

  /** False keeps the selection in the trigger alone — a filter bar has a table under it. */
  chips?: boolean;
}

/**
 * Combobox for a list too long to render at once, choosing more than one. The list stays open on a
 * pick; the selection sits under the control as chips, because a button cannot hold buttons.
 */
export function MultiCombobox({
  value,
  onChange,
  selectedLabels,
  chips = true,
  ...list
}: Readonly<MultiComboboxProps>) {
  const [open, setOpen] = React.useState(false);
  const placeholder = list.placeholder ?? 'Choose…';

  const labelFor = (item: string) =>
    list.items.find((option) => option.value === item)?.label ?? selectedLabels?.[item] ?? item;

  const toggle = (item: string) =>
    onChange(value.includes(item) ? value.filter((chosen) => chosen !== item) : [...value, item]);

  const chosenLabels = value.map(labelFor);

  /** Named, not counted: "2 selected" makes the reader open the list to learn what they chose. */
  const triggerLabel = () => (value.length === 0 ? placeholder : chosenLabels.join(', '));

  return (
    <div className="min-w-0">
      <ComboboxShell
        {...list}
        multiple
        open={open}
        onOpenChange={setOpen}
        triggerLabel={triggerLabel()}
        triggerMuted={value.length === 0}
        // One choice already reads in full; several are what the trigger has to cut.
        triggerTooltip={value.length > 1 ? chosenLabels.join(', ') : undefined}
      >
        {list.items.map((item) => (
          <ComboboxOption
            key={item.value}
            label={item.label}
            hint={item.hint}
            selected={value.includes(item.value)}
            onSelect={() => toggle(item.value)}
          />
        ))}
      </ComboboxShell>

      {chips && value.length > 0 ? (
        <div className="mt-2 flex flex-wrap items-center gap-1">
          {value.map((item) => (
            <Badge key={item} variant="neutral" className="gap-1 pr-1">
              <span className="truncate">{labelFor(item)}</span>
              <button
                type="button"
                aria-label={`Remove ${labelFor(item)}`}
                onClick={() => onChange(value.filter((chosen) => chosen !== item))}
                className={cn(
                  'rounded-sm text-muted-foreground',
                  'hover:text-foreground focus-visible:shadow-focus focus-visible:outline-none',
                )}
              >
                <X className="size-3" aria-hidden />
              </button>
            </Badge>
          ))}
        </div>
      ) : null}
    </div>
  );
}
