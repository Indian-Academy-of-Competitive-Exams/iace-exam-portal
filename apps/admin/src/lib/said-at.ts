import { INSTITUTE_TIME_ZONE } from '@iace/contracts';

const SAID_AT = new Intl.DateTimeFormat('en-IN', {
  timeZone: INSTITUTE_TIME_ZONE,
  day: 'numeric',
  month: 'short',
  hour: 'numeric',
  minute: '2-digit',
});

/** When a thread message was said, on the institute's clock. */
export const saidAt = (at: string): string => SAID_AT.format(new Date(at));
