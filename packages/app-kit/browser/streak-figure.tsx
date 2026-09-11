import { ChartFigure, Metric, Tooltip, TooltipContent, TooltipTrigger, cn, plural } from '@iace/ui';
import { useEffect, useRef } from 'react';
import {
  currentStreak,
  instituteDayLabel,
  longestStreak,
  testDayWindow,
  type TestCalendar,
  type TestDay,
} from '@iace/contracts';

/** The tint carries the count, so a heavy day and a light one are not the same square. */
const HEAT = ['bg-muted', 'bg-primary-subtle', 'bg-primary/50', 'bg-primary'] as const;

const heatOf = (sittings: number) => HEAT[Math.min(sittings, HEAT.length - 1)];

/** A civil date carries no zone, so its month is read where it is stored: at UTC midnight. */
const MONTH = new Intl.DateTimeFormat('en-IN', { month: 'short', timeZone: 'UTC' });

/** Every day since the account opened, and the two runs behind them. */
export function StreakFigure({
  calendar,
  className,
}: Readonly<{ calendar: TestCalendar; className?: string }>) {
  const { days } = calendar;
  const window = testDayWindow(days, calendar.from);
  const weeks = weeksOf(window);
  const sat = window.filter((day) => day.sittings > 0).length;
  const now = currentStreak(days);
  const best = longestStreak(days);
  const scroller = useRef<HTMLDivElement>(null);

  // Today is the right-hand edge, and today is what a reader opens this to see.
  useEffect(() => {
    const held = scroller.current;
    if (held !== null) held.scrollLeft = held.scrollWidth;
  }, [weeks.length]);

  return (
    <ChartFigure
      title="Test days"
      meta={`${sat} of ${window.length}`}
      figure={
        <div className="flex items-start gap-6">
          <Metric size="sm" label="Streak" value={now} unit={dayWord(now)} />
          <Metric size="sm" label="Longest" value={best} unit={dayWord(best)} />
        </div>
      }
      className={cn('min-w-0', className)}
    >
      {/* Sideways inside the page's vertical scroll — a different axis hides nothing. */}
      <div ref={scroller} className="flex gap-1 overflow-x-auto pb-1">
        {weeks.map((week) => (
          <div key={week.key} className="flex shrink-0 flex-col gap-1">
            <span className="h-4 text-[0.625rem] leading-4 text-muted-foreground">
              {week.month ?? ''}
            </span>
            {week.days.map((day, index) => (
              <Cell key={day?.date ?? `${week.key}-${index}`} day={day} />
            ))}
          </div>
        ))}
      </div>
    </ChartFigure>
  );
}

function Cell({ day }: Readonly<{ day: TestDay | null }>) {
  if (day === null) return <span className="size-4" />;
  const tip = dayTip(day.date, day.sittings);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={cn('size-4 rounded-sm', heatOf(day.sittings))} aria-label={tip} />
      </TooltipTrigger>
      <TooltipContent>{tip}</TooltipContent>
    </Tooltip>
  );
}

interface Week {
  key: string;
  /** Named on the first column the month appears in, so the axis is read once per month. */
  month: string | null;
  /** Seven entries, Sunday first; null pads the partial weeks at either end. */
  days: (TestDay | null)[];
}

const WEEK = 7;

/** Columns of weekdays: a calendar is read down a week and across the weeks, never in one line. */
function weeksOf(window: readonly TestDay[]): Week[] {
  const first = window[0];
  if (first === undefined) return [];

  const lead = Array.from<null>({ length: weekdayOf(first.date) }).fill(null);
  const cells: (TestDay | null)[] = [...lead, ...window];
  const weeks: Week[] = [];
  let named: string | null = null;

  for (let at = 0; at < cells.length; at += WEEK) {
    const days = cells.slice(at, at + WEEK);
    const opens = days.find((day) => day !== null);
    const month = opens === undefined ? null : monthOf(opens.date);
    weeks.push({
      key: opens?.date ?? String(at),
      month: month === named ? null : month,
      days: [...days, ...Array.from<null>({ length: WEEK - days.length }).fill(null)],
    });
    if (month !== null) named = month;
  }
  return weeks;
}

const dayWord = (days: number) => (days === 1 ? 'day' : 'days');

const weekdayOf = (date: string) => new Date(`${date}T00:00:00.000Z`).getUTCDay();
const monthOf = (date: string) => MONTH.format(new Date(`${date}T00:00:00.000Z`));

function dayTip(date: string, sittings: number): string {
  const label = instituteDayLabel(`${date}T00:00:00.000Z`) ?? date;
  return `${label} — ${plural(sittings, 'sitting')}`;
}
