import * as React from 'react';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '../../lib/utils';
import { FIELD_TRIGGER_CLASS } from './combobox-shell';

/** Six weeks, always: a month that needs five must not resize the popover when you page to one that needs six. */
const GRID_CELLS = 42;
const DAYS_IN_WEEK = 7;
const MONTHS_IN_YEAR = 12;

/** One screen of years: a decade, plus the year either side to fill the month grid's 3x4 shape. */
const YEARS_PER_PAGE = 12;
const YEARS_IN_DECADE = 10;

export interface CalendarDay {
  /** `YYYY-MM-DD`, the shape `dateOnlySchema` takes and the wire carries. */
  iso: string;
  day: number;
  /** False for the leading and trailing days borrowed from the neighbouring months. */
  inMonth: boolean;
}

/** Which grid the popover is showing. Clicking the heading drills out, picking drills back in. */
export type CalendarMode = 'day' | 'month' | 'year';

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

/** A span is only unreachable when EVERY day in it is, so a half-allowed month stays clickable. */
function isSpanOutOfRange(first: string, last: string, min?: string, max?: string): boolean {
  return Boolean((min && last < min) || (max && first > max));
}

/** Whether no day of this month can be chosen. */
export function isMonthOutOfRange(
  year: number,
  month: number,
  min?: string,
  max?: string,
): boolean {
  return isSpanOutOfRange(toISODate(year, month, 1), toISODate(year, month + 1, 0), min, max);
}

/** Whether no day of this year can be chosen. */
export function isYearOutOfRange(year: number, min?: string, max?: string): boolean {
  return isSpanOutOfRange(toISODate(year, 0, 1), toISODate(year, 11, 31), min, max);
}

export function shiftMonth(year: number, month: number, by: number) {
  const date = new Date(Date.UTC(year, month + by, 1));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() };
}

/** The decade a year belongs to. Decades rather than 12s, so the heading reads 2020 - 2029. */
export function yearBlock(year: number): { start: number; end: number } {
  const start = Math.floor(year / YEARS_IN_DECADE) * YEARS_IN_DECADE;
  return { start, end: start + YEARS_IN_DECADE - 1 };
}

/** The decade's ten, bookended by one neighbour each side — the borrowed days of the year grid. */
export function yearsOf(block: { start: number }): number[] {
  return Array.from({ length: YEARS_PER_PAGE }, (_, index) => block.start - 1 + index);
}

type DateParts = { year: number; month: number; day: number };

function shiftDays(from: DateParts, by: number): string {
  return toISODate(from.year, from.month, from.day + by);
}

/** Clamped, so 31 January plus a month is 28 February rather than rolling into March. */
function addMonths(from: DateParts, by: number): string {
  const { year, month } = shiftMonth(from.year, from.month, by);
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return toISODate(year, month, Math.min(from.day, lastDay));
}

/** Where an arrow key moves the focused day. */
const ARROW_DAYS: Readonly<Record<string, number>> = {
  ArrowLeft: -1,
  ArrowRight: 1,
  ArrowUp: -DAYS_IN_WEEK,
  ArrowDown: DAYS_IN_WEEK,
};

/** The next focused day for a keystroke, or null when the key is not ours to handle. */
export function nextFocusedDate(iso: string, key: string, shiftKey = false): string | null {
  const from = parseISODate(iso);
  if (!from) return null;

  const days = ARROW_DAYS[key];
  if (days !== undefined) return shiftDays(from, days);

  if (key === 'Home' || key === 'End') {
    const weekday = new Date(Date.UTC(from.year, from.month, from.day)).getUTCDay();
    return shiftDays(from, key === 'Home' ? -weekday : DAYS_IN_WEEK - 1 - weekday);
  }

  if (key === 'PageUp' || key === 'PageDown') {
    const by = key === 'PageUp' ? -1 : 1;
    return addMonths(from, shiftKey ? by * MONTHS_IN_YEAR : by);
  }

  return null;
}

/** Every date here is a UTC-built civil date, so it is read back and rendered in UTC. */
const LOCAL_CIVIL_DATE = new Intl.DateTimeFormat('en-CA', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** The device's own date. An app that must pin a clock passes `max`/`min` instead. */
function todayWhereTheUserIs(): string {
  return LOCAL_CIVIL_DATE.format(new Date());
}

/** The same day off the clock rather than the string, so the calendar always has a month to open on. */
function monthOfToday() {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth(), day: now.getDate() };
}

const MONTH_LABEL = new Intl.DateTimeFormat(undefined, {
  timeZone: 'UTC',
  month: 'long',
  year: 'numeric',
});
const MONTH_NAME = new Intl.DateTimeFormat(undefined, { timeZone: 'UTC', month: 'short' });
const WEEKDAY_LABEL = new Intl.DateTimeFormat(undefined, { timeZone: 'UTC', weekday: 'short' });
const FULL_LABEL = new Intl.DateTimeFormat(undefined, { timeZone: 'UTC', dateStyle: 'full' });
const TRIGGER_LABEL = new Intl.DateTimeFormat(undefined, { timeZone: 'UTC', dateStyle: 'medium' });

/** Sunday-first headings, named by the runtime locale rather than hardcoded English. */
const WEEKDAYS = Array.from({ length: DAYS_IN_WEEK }, (_, index) =>
  WEEKDAY_LABEL.format(new Date(Date.UTC(2024, 0, 7 + index))),
);

const MONTH_NAMES = Array.from({ length: MONTHS_IN_YEAR }, (_, index) =>
  MONTH_NAME.format(new Date(Date.UTC(2024, index, 1))),
);

/** What the heading reads in each mode — the month, its year, or the decade on show. */
export function headingFor(
  mode: CalendarMode,
  view: { year: number; month: number },
  block: { start: number; end: number },
): string {
  if (mode === 'day') return MONTH_LABEL.format(new Date(Date.UTC(view.year, view.month, 1)));
  if (mode === 'month') return String(view.year);
  return `${block.start} – ${block.end}`;
}

/** What the heading says and does in each mode, and what a chevron pages by. */
const MODE_OUT: Readonly<Record<CalendarMode, CalendarMode>> = {
  day: 'month',
  month: 'year',
  year: 'year',
};

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
  const today = todayWhereTheUserIs();

  const opening = selected ?? parseISODate(today) ?? monthOfToday();
  const [view, setView] = React.useState({ year: opening.year, month: opening.month });
  const [mode, setMode] = React.useState<CalendarMode>('day');
  const [focused, setFocused] = React.useState(value || today);

  // Re-seeded on every open, so reopening lands on the chosen month rather than wherever it was left.
  const onOpen = (next: boolean) => {
    if (next) {
      const from = parseISODate(value) ?? parseISODate(today) ?? monthOfToday();
      setView({ year: from.year, month: from.month });
      setFocused(value || today);
      setMode('day');
    }
    setOpen(next);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (mode !== 'day') return;
    const iso = nextFocusedDate(focused || today, event.key, event.shiftKey);
    if (iso === null) return;
    event.preventDefault();
    const parts = parseISODate(iso);
    if (parts === null) return;
    setFocused(iso);
    setView({ year: parts.year, month: parts.month });
  };

  const choose = (iso: string) => {
    onChange(iso);
    setOpen(false);
  };

  // A chevron pages by whatever the current grid is a page of.
  const page = (by: number) => {
    if (mode === 'day') return setView((c) => shiftMonth(c.year, c.month, by));
    const years = mode === 'month' ? by : by * YEARS_IN_DECADE;
    setView((c) => ({ ...c, year: c.year + years }));
  };

  const block = yearBlock(view.year);
  const heading = headingFor(mode, view, block);
  const canZoomOut = MODE_OUT[mode] !== mode;

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
          <span className={cn('truncate', !selected && 'text-placeholder')}>
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
            <NavButton label={PAGE_BACK_LABEL[mode]} onClick={() => page(-1)}>
              <ChevronLeft className="size-4" aria-hidden />
            </NavButton>
            {/* The caret is the whole affordance: without it the heading reads as a label. */}
            <button
              type="button"
              onClick={() => setMode(MODE_OUT[mode])}
              disabled={!canZoomOut}
              aria-live="polite"
              aria-label={canZoomOut ? `${heading}. ${ZOOM_OUT_LABEL[mode]}` : heading}
              className="flex items-center gap-1 rounded-sm px-2 py-1 text-sm font-medium tabular-nums hover:bg-muted focus-visible:shadow-focus focus-visible:outline-none disabled:hover:bg-transparent [&_svg]:size-3.5 [&_svg]:text-muted-foreground"
            >
              {heading}
              {canZoomOut ? <ChevronDown aria-hidden /> : null}
            </button>
            <NavButton label={PAGE_NEXT_LABEL[mode]} onClick={() => page(1)}>
              <ChevronRight className="size-4" aria-hidden />
            </NavButton>
          </div>

          {/* One height for all three grids, so drilling in and out never resizes the popover. */}
          <div className="min-h-[14rem]">
            {mode === 'day' ? (
              <DayGrid
                view={view}
                value={value}
                today={today}
                focused={focused}
                min={min}
                max={max}
                onSelect={choose}
                onFocus={setFocused}
              />
            ) : null}

            {mode === 'month' ? (
              <PickerGrid
                label="Choose a month"
                items={MONTH_NAMES.map((name, month) => ({
                  key: month,
                  label: name,
                  current: month === view.month,
                  outside: false,
                  disabled: isMonthOutOfRange(view.year, month, min, max),
                }))}
                onPick={(month) => {
                  setView((c) => ({ ...c, month }));
                  setMode('day');
                }}
              />
            ) : null}

            {mode === 'year' ? (
              <PickerGrid
                label="Choose a year"
                items={yearsOf(block).map((year) => ({
                  key: year,
                  label: String(year),
                  current: year === view.year,
                  outside: year < block.start || year > block.end,
                  disabled: isYearOutOfRange(year, min, max),
                }))}
                onPick={(year) => {
                  setView((c) => ({ ...c, year }));
                  setMode('month');
                }}
              />
            ) : null}
          </div>

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

const PAGE_BACK_LABEL: Readonly<Record<CalendarMode, string>> = {
  day: 'Previous month',
  month: 'Previous year',
  year: 'Previous years',
};

const PAGE_NEXT_LABEL: Readonly<Record<CalendarMode, string>> = {
  day: 'Next month',
  month: 'Next year',
  year: 'Next years',
};

const ZOOM_OUT_LABEL: Readonly<Record<CalendarMode, string>> = {
  day: 'Choose a month',
  month: 'Choose a year',
  year: '',
};

function DayGrid({
  view,
  value,
  today,
  focused,
  min,
  max,
  onSelect,
  onFocus,
}: Readonly<{
  view: { year: number; month: number };
  value: string;
  today: string;
  focused: string;
  min?: string;
  max?: string;
  onSelect: (iso: string) => void;
  onFocus: (iso: string) => void;
}>) {
  return (
    // A calendar IS a week-by-weekday grid, and <td> carries the gridcell role for free.
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
        {weeksOf(monthGrid(view.year, view.month)).map((week, index) => (
          <tr key={week[0]?.iso ?? index}>
            {week.map((cell) => (
              <td key={cell.iso} className="p-[1px]">
                <DayCell
                  cell={cell}
                  selected={cell.iso === value}
                  today={cell.iso === today}
                  focused={cell.iso === focused}
                  disabled={isOutOfRange(cell.iso, min, max)}
                  onSelect={onSelect}
                  onFocus={onFocus}
                />
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

interface PickerItem {
  key: number;
  label: string;
  current: boolean;
  /** Shown for continuity but belonging to the neighbouring decade, like a borrowed day. */
  outside: boolean;
  disabled: boolean;
}

/** The month and year grids are the same control twice, so they are one component. */
function PickerGrid({
  label,
  items,
  onPick,
}: Readonly<{ label: string; items: PickerItem[]; onPick: (key: number) => void }>) {
  return (
    <fieldset className="grid min-w-0 grid-cols-3 gap-1" aria-label={label}>
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          disabled={item.disabled}
          aria-current={item.current ? 'true' : undefined}
          onClick={() => onPick(item.key)}
          className={cn(
            'h-11 rounded-sm text-sm tabular-nums transition-colors',
            'hover:bg-muted focus-visible:shadow-focus focus-visible:outline-none',
            item.outside && 'text-muted-foreground/60',
            item.current && 'bg-primary text-primary-foreground hover:bg-primary',
            item.disabled && 'cursor-not-allowed opacity-40 hover:bg-transparent',
          )}
        >
          {item.label}
        </button>
      ))}
    </fieldset>
  );
}

function NavButton({
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
