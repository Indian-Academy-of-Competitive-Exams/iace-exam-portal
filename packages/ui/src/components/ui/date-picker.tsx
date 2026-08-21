import * as React from 'react';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '../../lib/utils';
import { FIELD_TRIGGER_CLASS } from './combobox-shell';

/** Six weeks, always: a month that needs five must not resize the popover when you page to one that needs six. */
const GRID_CELLS = 42;
const DAYS_IN_WEEK = 7;

export interface CalendarDay {
  /** `YYYY-MM-DD`, the shape `dateOnlySchema` takes and the wire carries. */
  iso: string;
  day: number;
  /** False for the leading and trailing days borrowed from the neighbouring months. */
  inMonth: boolean;
}

/** `YYYY-MM-DD` from parts. UTC throughout, or a picker west of Greenwich lands a day early. */
export function toISODate(year: number, month: number, day: number): string {
  return new Date(Date.UTC(year, month, day)).toISOString().slice(0, 10);
}

/** Parsed, or null for anything that is not a real `YYYY-MM-DD`. */
export function parseISODate(value: string | null | undefined) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number) as [number, number, number];
  // Round-tripped, so 2026-02-31 is rejected rather than silently becoming March.
  if (toISODate(year, month - 1, day) !== value) return null;
  return { year, month: month - 1, day };
}

/** The 42 cells a month is drawn in, Sunday first. */
export function monthGrid(year: number, month: number): CalendarDay[] {
  const leading = new Date(Date.UTC(year, month, 1)).getUTCDay();

  return Array.from({ length: GRID_CELLS }, (_, index) => {
    const date = new Date(Date.UTC(year, month, 1 - leading + index));
    return {
      iso: date.toISOString().slice(0, 10),
      day: date.getUTCDate(),
      inMonth: date.getUTCMonth() === month,
    };
  });
}

/** The flat six-week run, in rows of seven. */
export function weeksOf(cells: CalendarDay[]): CalendarDay[][] {
  return Array.from({ length: cells.length / 7 }, (_, week) => cells.slice(week * 7, week * 7 + 7));
}

/** Outside `min`/`max`, inclusive at both ends. String compare is safe on `YYYY-MM-DD`. */
export function isOutOfRange(iso: string, min?: string, max?: string): boolean {
  return Boolean((min && iso < min) || (max && iso > max));
}

function shiftMonth(year: number, month: number, by: number) {
  const date = new Date(Date.UTC(year, month + by, 1));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() };
}

/** Where an arrow key moves the focused day. */
const ARROW_DAYS: Readonly<Record<string, number>> = {
  ArrowLeft: -1,
  ArrowRight: 1,
  ArrowUp: -DAYS_IN_WEEK,
  ArrowDown: DAYS_IN_WEEK,
};

const MONTH_LABEL = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' });
const WEEKDAY_LABEL = new Intl.DateTimeFormat(undefined, { weekday: 'short' });
const FULL_LABEL = new Intl.DateTimeFormat(undefined, { dateStyle: 'full' });
const TRIGGER_LABEL = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });

/** Sunday-first headings, named by the runtime locale rather than hardcoded English. */
const WEEKDAYS = Array.from({ length: DAYS_IN_WEEK }, (_, index) =>
  WEEKDAY_LABEL.format(new Date(Date.UTC(2024, 0, 7 + index))),
);

export interface DatePickerProps {
  /** `YYYY-MM-DD`, or '' for nothing chosen. */
  value: string;
  onChange: (value: string) => void;
  min?: string;
  max?: string;
  placeholder?: string;
  disabled?: boolean;
  clearable?: boolean;
  id?: string;
  'aria-label'?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
  className?: string;
}

/** A date, chosen from a calendar this app draws — never the browser's, which differs per machine. */
export function DatePicker({
  value,
  onChange,
  min,
  max,
  placeholder = 'Choose a date',
  disabled = false,
  clearable = true,
  id,
  className,
  ...aria
}: Readonly<DatePickerProps>) {
  const [open, setOpen] = React.useState(false);
  const selected = parseISODate(value);
  const today = new Date().toISOString().slice(0, 10);

  const opening = selected ?? parseISODate(today)!;
  const [view, setView] = React.useState({ year: opening.year, month: opening.month });
  const [focused, setFocused] = React.useState(value || today);

  // Re-seeded on every open, so reopening lands on the chosen month rather than wherever it was left.
  const onOpen = (next: boolean) => {
    if (next) {
      const from = parseISODate(value) ?? parseISODate(today)!;
      setView({ year: from.year, month: from.month });
      setFocused(value || today);
    }
    setOpen(next);
  };

  const move = (by: number) => {
    const from = parseISODate(focused) ?? parseISODate(today)!;
    const next = new Date(Date.UTC(from.year, from.month, from.day + by));
    const iso = next.toISOString().slice(0, 10);
    setFocused(iso);
    setView({ year: next.getUTCFullYear(), month: next.getUTCMonth() });
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    const by = ARROW_DAYS[event.key];
    if (by === undefined) return;
    event.preventDefault();
    move(by);
  };

  const choose = (iso: string) => {
    onChange(iso);
    setOpen(false);
  };

  const page = (by: number) => setView((current) => shiftMonth(current.year, current.month, by));

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={onOpen}>
      <PopoverPrimitive.Trigger asChild>
        <button
          type="button"
          id={id}
          disabled={disabled}
          className={cn(FIELD_TRIGGER_CLASS, className)}
          {...aria}
        >
          <span className={cn('truncate', !selected && 'text-muted-foreground')}>
            {selected ? TRIGGER_LABEL.format(new Date(`${value}T00:00:00Z`)) : placeholder}
          </span>
          <CalendarDays className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        </button>
      </PopoverPrimitive.Trigger>

      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="start"
          sideOffset={4}
          onKeyDown={onKeyDown}
          className="z-50 w-[17.5rem] rounded-md border border-border bg-popover p-3 text-popover-foreground shadow-lg"
        >
          <div className="mb-2 flex items-center justify-between gap-2">
            <MonthButton label="Previous month" onClick={() => page(-1)}>
              <ChevronLeft className="size-4" aria-hidden />
            </MonthButton>
            <span aria-live="polite" className="text-sm font-medium">
              {MONTH_LABEL.format(new Date(Date.UTC(view.year, view.month, 1)))}
            </span>
            <MonthButton label="Next month" onClick={() => page(1)}>
              <ChevronRight className="size-4" aria-hidden />
            </MonthButton>
          </div>

          {/* A real table: a calendar IS a week-by-weekday grid, and <td> carries the
              gridcell role so the day stays a plain button. */}
          <table className="w-full border-collapse" aria-label="Calendar">
            <thead>
              <tr>
                {WEEKDAYS.map((name) => (
                  <th
                    key={name}
                    scope="col"
                    className="pb-1 text-center text-xs font-medium text-muted-foreground"
                  >
                    {name.slice(0, 2)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {weeksOf(monthGrid(view.year, view.month)).map((week) => (
                <tr key={week[0]!.iso}>
                  {week.map((cell) => (
                    <td key={cell.iso} className="p-[1px]">
                      <DayCell
                        cell={cell}
                        selected={cell.iso === value}
                        today={cell.iso === today}
                        focused={cell.iso === focused}
                        disabled={isOutOfRange(cell.iso, min, max)}
                        onSelect={choose}
                        onFocus={setFocused}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>

          {clearable ? (
            <button
              type="button"
              onClick={() => choose('')}
              className="mt-2 w-full rounded-sm py-1.5 text-center text-xs text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:bg-muted focus-visible:outline-none"
            >
              Clear
            </button>
          ) : null}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}

function MonthButton({
  label,
  onClick,
  children,
}: Readonly<{ label: string; onClick: () => void; children: React.ReactNode }>) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="rounded-sm p-1 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:shadow-focus focus-visible:outline-none"
    >
      {children}
    </button>
  );
}

/** Roving tabindex: one cell is tabbable and the arrows move which, so Tab does not visit 42 buttons. */
function DayCell({
  cell,
  selected,
  today,
  focused,
  disabled,
  onSelect,
  onFocus,
}: Readonly<{
  cell: CalendarDay;
  selected: boolean;
  today: boolean;
  focused: boolean;
  disabled: boolean;
  onSelect: (iso: string) => void;
  onFocus: (iso: string) => void;
}>) {
  const ref = React.useRef<HTMLButtonElement>(null);

  React.useEffect(() => {
    if (focused && ref.current && document.activeElement !== ref.current) ref.current.focus();
  }, [focused]);

  return (
    <button
      ref={ref}
      type="button"
      tabIndex={focused ? 0 : -1}
      disabled={disabled}
      aria-pressed={selected}
      aria-current={today ? 'date' : undefined}
      aria-label={FULL_LABEL.format(new Date(`${cell.iso}T00:00:00Z`))}
      onClick={() => onSelect(cell.iso)}
      onFocus={() => onFocus(cell.iso)}
      className={cn(
        'h-8 w-full rounded-sm text-sm tabular-nums transition-colors',
        'hover:bg-muted focus-visible:shadow-focus focus-visible:outline-none',
        !cell.inMonth && 'text-muted-foreground/60',
        today && !selected && 'font-semibold text-primary',
        selected && 'bg-primary text-primary-foreground hover:bg-primary',
        disabled && 'cursor-not-allowed opacity-40 hover:bg-transparent',
      )}
    >
      {cell.day}
    </button>
  );
}
