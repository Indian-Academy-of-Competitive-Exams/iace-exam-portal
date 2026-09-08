import { ChartFigure, Metric, Tooltip, TooltipContent, TooltipTrigger, cn, plural } from '@iace/ui';
import {
  currentStreak,
  instituteDayLabel,
  practiceDays,
  type PerformancePoint,
} from '@iace/contracts';

/** Four weeks reads as a habit; a longer window turns the strip into a wall. */
const WINDOW_DAYS = 28;

/** The tint carries the count, so a heavy day and a light one are not the same square. */
const HEAT = ['bg-muted', 'bg-primary-subtle', 'bg-primary/50', 'bg-primary'] as const;

const heatOf = (sittings: number) => HEAT[Math.min(sittings, HEAT.length - 1)];

/** Off the trend, not the rollup: the two student tables carry sums with no day on them. */
export function StreakFigure({
  points,
  className,
}: Readonly<{ points: readonly PerformancePoint[]; className?: string }>) {
  const days = practiceDays(points, WINDOW_DAYS);
  const streak = currentStreak(points);
  const sat = days.filter((day) => day.sittings > 0).length;

  return (
    <ChartFigure
      title="Practice days"
      meta={`${sat} of the last ${WINDOW_DAYS}`}
      figure={
        <Metric size="sm" label="Streak" value={streak} unit={streak === 1 ? 'day' : 'days'} />
      }
      className={cn('min-w-0', className)}
    >
      {/* Seven to a row, so each row is a week and the eye reads left to right into today. */}
      <div className="grid w-fit grid-cols-[repeat(7,auto)] gap-1.5">
        {days.map((day) => (
          <Tooltip key={day.date}>
            <TooltipTrigger asChild>
              <span
                className={cn('size-5 rounded-sm', heatOf(day.sittings))}
                aria-label={dayTip(day.date, day.sittings)}
              />
            </TooltipTrigger>
            <TooltipContent>{dayTip(day.date, day.sittings)}</TooltipContent>
          </Tooltip>
        ))}
      </div>
    </ChartFigure>
  );
}

function dayTip(date: string, sittings: number): string {
  const label = instituteDayLabel(`${date}T00:00:00.000Z`) ?? date;
  return `${label} — ${plural(sittings, 'sitting')}`;
}
