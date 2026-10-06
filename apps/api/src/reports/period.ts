/** A report's period: two civil dates at the institute, and the instants that bound them. */
import { instituteDayLabel, reportPeriodDays, type ReportFact } from '@iace/contracts';
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

/** Every institute day of the period, in order: counted out, never compared as text, which year 10000 breaks. */
export function daysOf(period: Period): string[] {
  return Array.from({ length: reportPeriodDays(period) }, (_, at) =>
    shiftInstituteDay(period.from, at),
  );
}

/** The same number of days, ending the day before this one starts: what "the period before" means. */
export function periodBefore(period: Period): Period {
  return periodOf({
    from: shiftInstituteDay(period.from, -reportPeriodDays(period)),
    to: shiftInstituteDay(period.from, -1),
  });
}

/** The period as far as it has got: a test that opens on Friday has not opened on Monday. */
export function elapsed(period: Period, now = new Date()): Period['within'] {
  return { gte: period.within.gte, lte: now < period.within.lte ? now : period.within.lte };
}

const dayLabel = (day: string): string => instituteDayLabel(startOfInstituteDay(day));

export const aboutPeriod = (period: Period): ReportFact => ({
  label: 'Period',
  value:
    period.from === period.to
      ? dayLabel(period.from)
      : `${dayLabel(period.from)} to ${dayLabel(period.to)}`,
});
