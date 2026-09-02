import { cn } from '../../lib/utils';

export interface SegmentedItem {
  value: string;
  label: string;
  /** The word behind a short label — the accessible name, where "EN" is not one. */
  name?: string;
}

export interface SegmentedControlProps {
  value: string;
  onChange: (value: string) => void;
  items: readonly SegmentedItem[];
  disabled?: boolean;
  'aria-label': string;
  className?: string;
}

/** A choice small enough to show whole — a MODE the reader switches, not a field they fill. */
export function SegmentedControl({
  value,
  onChange,
  items,
  disabled = false,
  'aria-label': label,
  className,
}: Readonly<SegmentedControlProps>) {
  const move = (from: number, step: number) => {
    const next = items[(from + step + items.length) % items.length];
    if (next) onChange(next.value);
  };

  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn(
        'inline-flex items-center gap-0.5 rounded-md border border-border bg-muted p-0.5',
        className,
      )}
    >
      {items.map((item, index) => {
        const active = item.value === value;
        return (
          <button
            key={item.value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={item.name}
            disabled={disabled}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(item.value)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowRight' || event.key === 'ArrowDown') move(index, 1);
              if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') move(index, -1);
            }}
            className={cn(
              'rounded px-2 py-0.5 text-xs font-semibold transition-colors',
              'focus-visible:shadow-focus focus-visible:outline-none',
              active
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground',
              disabled && 'cursor-not-allowed opacity-60',
            )}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
