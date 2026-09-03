/** A civil date is a day at the institute, so its bounds are IST midnights, not UTC ones. */

import { TZDate } from '@date-fns/tz';
import { addDays, endOfDay, startOfDay } from 'date-fns';
import { INSTITUTE_TIME_ZONE, civilDate } from '@iace/contracts';

function atInstitute(day: string): TZDate {
  const [year = 0, month = 1, date = 1] = day.split('-').map(Number);
  return new TZDate(year, month - 1, date, INSTITUTE_TIME_ZONE);
}

/** The instant `YYYY-MM-DD` begins at the institute. */
export function startOfInstituteDay(day: string): Date {
  return new Date(startOfDay(atInstitute(day)));
}

/** The last instant of `YYYY-MM-DD` at the institute, for an inclusive upper bound. */
export function endOfInstituteDay(day: string): Date {
  return new Date(endOfDay(atInstitute(day)));
}

/** Which institute day an instant fell on — the answer UTC gets wrong before 05:30. */
export function instituteDayOf(at: Date): string {
  return civilDate(at);
}

/** `YYYY-MM-DD` a number of institute days away, which is not always 24 hours elsewhere. */
export function shiftInstituteDay(day: string, days: number): string {
  return civilDate(new Date(addDays(atInstitute(day), days)));
}

/** A `@db.Date` column holds a civil date at UTC midnight — a storage convention, not a zone. */
export function toDateColumn(day: string): Date {
  return new Date(`${day}T00:00:00Z`);
}

/** The civil date a `@db.Date` column was holding. */
export function fromDateColumn(value: Date): string {
  return value.toISOString().slice(0, 10);
}
