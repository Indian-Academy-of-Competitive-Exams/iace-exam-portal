/** A civil date is a day at the institute, so its bounds are IST midnights, not UTC ones. */

import { TZDate } from '@date-fns/tz';
import { endOfDay, startOfDay } from 'date-fns';
import { INSTITUTE_TIME_ZONE } from '@iace/contracts';

function atInstitute(civilDate: string): TZDate {
  const [year, month, day] = civilDate.split('-').map(Number);
  return new TZDate(year!, month! - 1, day!, INSTITUTE_TIME_ZONE);
}

/** The instant `YYYY-MM-DD` begins at the institute. */
export function startOfInstituteDay(civilDate: string): Date {
  return new Date(startOfDay(atInstitute(civilDate)));
}

/** The last instant of `YYYY-MM-DD` at the institute, for an inclusive upper bound. */
export function endOfInstituteDay(civilDate: string): Date {
  return new Date(endOfDay(atInstitute(civilDate)));
}
