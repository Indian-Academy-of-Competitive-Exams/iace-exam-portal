/** Normalises whatever shape a spreadsheet put a date in; validity is judged after, by the schema. */

const MONTH_NAMES = [
  'jan',
  'feb',
  'mar',
  'apr',
  'may',
  'jun',
  'jul',
  'aug',
  'sep',
  'oct',
  'nov',
  'dec',
] as const;

/** Below this a number is a stray figure, not a date — Excel's own serial 61 is 1 March 1900. */
const EARLIEST_SERIAL = 61;

const SERIAL_EPOCH_UTC = Date.UTC(1899, 11, 30);
const MS_PER_DAY = 86_400_000;

const pad = (value: number): string => String(value).padStart(2, '0');

const assemble = (year: number, month: number, day: number): string =>
  `${String(year).padStart(4, '0')}-${pad(month)}-${pad(day)}`;

function fromSerial(value: string): string | null {
  if (!/^\d+(\.\d+)?$/.test(value)) return null;
  const serial = Math.floor(Number(value));
  if (serial < EARLIEST_SERIAL) return null;
  const date = new Date(SERIAL_EPOCH_UTC + serial * MS_PER_DAY);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function fromIsoLike(value: string): string | null {
  const match = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(value);
  return match ? assemble(Number(match[1]), Number(match[2]), Number(match[3])) : null;
}

function monthFromName(name: string): number | null {
  const index = MONTH_NAMES.indexOf(name.slice(0, 3).toLowerCase() as (typeof MONTH_NAMES)[number]);
  return index === -1 ? null : index + 1;
}

function fromNamedMonth(value: string): string | null {
  const dayFirst = /^(\d{1,2})[\s\-/.]+([A-Za-z]{3,})[\s\-/.,]+(\d{4})$/.exec(value);
  if (dayFirst) {
    const month = monthFromName(dayFirst[2]!);
    return month ? assemble(Number(dayFirst[3]), month, Number(dayFirst[1])) : null;
  }
  const monthFirst = /^([A-Za-z]{3,})[\s\-/.]+(\d{1,2})[\s\-/.,]+(\d{4})$/.exec(value);
  if (monthFirst) {
    const month = monthFromName(monthFirst[1]!);
    return month ? assemble(Number(monthFirst[3]), month, Number(monthFirst[2])) : null;
  }
  return null;
}

function fromNumericParts(value: string): string | null {
  const match = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(value);
  if (!match) return null;
  const first = Number(match[1]);
  const second = Number(match[2]);
  const year = Number(match[3]);
  // Whichever part cannot be a month IS the day; when both could be, this institute writes day first.
  if (second > 12) return assemble(year, first, second);
  return assemble(year, second, first);
}

export function toIsoDate(raw: string): string {
  const value = raw.trim();
  if (value === '') return value;
  return (
    fromIsoLike(value) ??
    fromNamedMonth(value) ??
    fromNumericParts(value) ??
    fromSerial(value) ??
    value
  );
}
