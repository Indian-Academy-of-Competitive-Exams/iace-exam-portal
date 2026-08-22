import { z } from 'zod';

/**
 * Which identity table a token belongs to — it decides the table, the Redis keyspace
 * and the reachable routes. Reference it as `ActorTypes.STUDENT`, never the bare string.
 */
export const ActorTypes = {
  STUDENT: 'STUDENT',
  ADMIN: 'ADMIN',
} as const;

export type ActorType = (typeof ActorTypes)[keyof typeof ActorTypes];

/** Every civil date — "today", a scheduling day, a report's day — is this clock, never UTC. */
export const INSTITUTE_TIME_ZONE = 'Asia/Kolkata';

/** `en-CA` is the locale that formats as YYYY-MM-DD, which is why it and not `en-IN`. */
const INSTITUTE_CIVIL_DATE = new Intl.DateTimeFormat('en-CA', {
  timeZone: INSTITUTE_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** The civil date at the institute for an instant — UTC would be a day behind before 05:30 IST. */
export function civilDate(at: Date = new Date()): string {
  return INSTITUTE_CIVIL_DATE.format(at);
}

/** Parts of an instant as the institute's clock reads them, which is what an offset is derived from. */
const INSTITUTE_PARTS = new Intl.DateTimeFormat('en-CA', {
  timeZone: INSTITUTE_TIME_ZONE,
  hour12: false,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

function instituteFieldsAt(at: Date): Record<string, number> {
  const fields: Record<string, number> = {};
  for (const part of INSTITUTE_PARTS.formatToParts(at)) {
    if (part.type !== 'literal') fields[part.type] = Number(part.value);
  }
  return fields;
}

/** Derived per instant rather than hard-coded, so a zone that ever gains a DST rule still works. */
function instituteOffsetMs(at: Date): number {
  const f = instituteFieldsAt(at);
  const asIfUtc = Date.UTC(f.year!, f.month! - 1, f.day!, f.hour! % 24, f.minute!, f.second!);
  return asIfUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/** An instant as `YYYY-MM-DDTHH:mm` on the institute's clock — what `datetime-local` takes. */
export function instituteWallTime(at: Date): string {
  const f = instituteFieldsAt(at);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${f.year}-${pad(f.month!)}-${pad(f.day!)}T${pad(f.hour! % 24)}:${pad(f.minute!)}`;
}

/** `YYYY-MM-DDTHH:mm` read as the institute's clock, back to the instant it names. */
export function fromInstituteWallTime(wallTime: string): Date {
  const [datePart, timePart = '00:00'] = wallTime.split('T');
  const [year, month, day] = datePart!.split('-').map(Number);
  const [hour, minute] = timePart.split(':').map(Number);
  const naive = Date.UTC(year!, month! - 1, day!, hour ?? 0, minute ?? 0);
  return new Date(naive - instituteOffsetMs(new Date(naive)));
}

export const actorTypeSchema = z.enum(ActorTypes);

/** An Indian mobile number, once normalised: 10 digits, leading 6-9. */
export const MOBILE_DIGITS = 10;

/** Country/trunk prefixes a student might type, longest first. */
const MOBILE_PREFIXES = ['+91', '0091', '91', '0'] as const;

/**
 * Reduces the usual forms to the bare 10 digits. A prefix is stripped ONLY when that
 * leaves 10: `9123456789` is a live series, and taking its "91" leaves 8.
 */
export function normaliseMobile(raw: string): string {
  const compact = raw.trim().replace(/[\s()-]/g, '');

  for (const prefix of MOBILE_PREFIXES) {
    if (compact.startsWith(prefix) && compact.length === prefix.length + MOBILE_DIGITS) {
      return compact.slice(prefix.length);
    }
  }
  return compact;
}

/** 10 digits, leading 6-9. Accepts the usual prefixes and separators; stores bare digits. */
export const mobileSchema = z
  .string()
  .transform(normaliseMobile)
  .pipe(
    z
      .string()
      .regex(
        new RegExp(String.raw`^[6-9]\d{${MOBILE_DIGITS - 1}}$`),
        'Enter a valid 10-digit mobile number',
      ),
  );

export const emailSchema = z
  .string()
  .transform((v) => v.trim().toLowerCase())
  .pipe(z.email('Enter a valid email address'));

export const otpCodeSchema = z
  .string()
  .transform((v) => v.trim())
  .pipe(z.string().regex(/^\d{4,8}$/, 'Enter the code sent to you'));

/** The one place the PIN length is decided. Everything else derives from it. */
export const PIN_LENGTH = 4;

/**
 * Entering an existing PIN: shape only, or the rules would reject accounts that exist.
 * A PIN is not unique across students — it is only checked against the one a mobile resolves to.
 */
export const pinSchema = z
  .string()
  .transform((v) => v.trim())
  .pipe(
    z
      .string()
      .regex(new RegExp(String.raw`^\d{${PIN_LENGTH}}$`), `Enter your ${PIN_LENGTH}-digit PIN`),
  );

/** Straight runs in either direction — the other half of the obvious guesses. */
const SEQUENTIAL_PINS = new Set(
  Array.from({ length: 10 - PIN_LENGTH + 1 }, (_, start) => {
    const run = Array.from({ length: PIN_LENGTH }, (_, i) => start + i).join('');
    return [run, [...run].reverse().join('')];
  }).flat(),
);

/** Choosing a PIN. The Redis lockout is the real protection; this only refuses the obvious ones. */
export const newPinSchema = pinSchema
  .refine(
    (v) => !new RegExp(String.raw`^(\d)\1{${PIN_LENGTH - 1}}$`).test(v),
    'Avoid a PIN that is all one digit',
  )
  .refine((v) => !SEQUENTIAL_PINS.has(v), 'Avoid a PIN in counting order');

// ============================================================================
// List-query params. Shared because a filter that parses differently in two
// modules is a filter that means two things.
// ============================================================================

/** A query param that is present-or-absent, never "false means don't care". */
export const optionalBooleanQuery = () =>
  z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true'));

/** How a filter holding several values travels: one param, `a,b`. Ids and enums hold no comma. */
export const CSV_SEPARATOR = ',';
export const CSV_QUERY_MAX = 50;

/** Absent when it names nothing: Prisma reads `in: []` as "match nothing", never as "don't care". */
const csvParts = (value: string | readonly string[] | undefined): string[] | undefined => {
  if (value === undefined) return undefined;
  const raw = typeof value === 'string' ? value.split(CSV_SEPARATOR) : value;
  const parts = [...new Set(raw.map((part) => part.trim()).filter(Boolean))];
  return parts.length > 0 ? parts : undefined;
};

/** Several values in one param, as CSV or as the set itself. An unknown member is refused. */
export const csvQuery = <T extends z.ZodType<string, string>>(member: T) =>
  z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform(csvParts)
    .pipe(z.array(member).max(CSV_QUERY_MAX).optional());

/** The same, for ids — there is no set of known members to check them against. */
export const csvIdQuery = () => csvQuery(z.string());

/** How a list combines its filters. A search and a date range sit outside it and always narrow. */
export const MATCH_MODES = {
  ALL: 'all',
  ANY: 'any',
} as const;
export type MatchMode = (typeof MATCH_MODES)[keyof typeof MATCH_MODES];
export const MATCH_MODE_VALUES = Object.values(MATCH_MODES) as [MatchMode, ...MatchMode[]];

/** Absent means ALL: a link that names no mode narrows, which is what every list did before. */
export const matchModeQuery = () => z.enum(MATCH_MODE_VALUES).optional().default(MATCH_MODES.ALL);

/** The free-text box every list carries. Blank is absent, not a search for "". */
export const SEARCH_QUERY_MAX = 64;

export const searchQuery = () =>
  z
    .string()
    .trim()
    .max(SEARCH_QUERY_MAX)
    .optional()
    .transform((v) => (v === '' ? undefined : v));

// The failure shape lives in ./envelope — there is one response envelope for
// the whole API, and NestJS's default error body is not it.
