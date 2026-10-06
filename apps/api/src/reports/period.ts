/** A report's period: two civil dates at the institute, and the instants that bound them. */
import { instituteDayLabel, type ReportFact } from '@iace/contracts';
import {
  endOfInstituteDay,
  shiftInstituteDay,
  startOfInstituteDay,
} from '../common/time/institute-day';

export interface Period {
  from: string;
  to: string;
  /** What a timestamp column is filtered by: both ends inclusive. */
  within: { gte: Date; lte: Date };
}

export function periodOf({ from, to }: { from: string; to: string }): Period {
  return { from, to, within: { gte: startOfInstituteDay(from), lte: endOfInstituteDay(to) } };
}

/** Every institute day of the period, in order. */
export function daysOf(period: Period): string[] {
  const days: string[] = [];
  for (let day = period.from; day <= period.to; day = shiftInstituteDay(day, 1)) days.push(day);
  return days;
}

/** The same number of days, ending the day before this one starts: what "the period before" means. */
export function periodBefore(period: Period): Period {
  const length = daysOf(period).length;
  return periodOf({
    from: shiftInstituteDay(period.from, -length),
    to: shiftInstituteDay(period.from, -1),
  });
}

const dayLabel = (day: string): string => instituteDayLabel(startOfInstituteDay(day));

export const aboutPeriod = (period: Period): ReportFact => ({
  label: 'Period',
  value:
    period.from === period.to
      ? dayLabel(period.from)
      : `${dayLabel(period.from)} to ${dayLabel(period.to)}`,
});
