/** What a student can take away of their own record, and how it is asked for: the same on the web and on the phone. */
import {
  REPORT_KEYS,
  REPORT_PERIODS,
  dateOnlySchema,
  instituteDayLabel,
  reportPeriodOf,
  todayISO,
  type ReportPeriodRange,
  type ReportQueryInput,
  type SatSitting,
  type StudentReportKey,
} from '@iace/contracts';

export const DOWNLOAD_KINDS = {
  WEEKLY: 'weekly',
  MONTHLY: 'monthly',
  TEST: 'test',
  EVERY_TEST: 'every-test',
  TOPICS: 'topics',
} as const;
export type DownloadKind = (typeof DOWNLOAD_KINDS)[keyof typeof DOWNLOAD_KINDS];

/** In the order they are offered; the first is what an untouched screen opens on. */
export const DOWNLOAD_KIND_LABELS: Readonly<Record<DownloadKind, string>> = {
  [DOWNLOAD_KINDS.WEEKLY]: 'Weekly',
  [DOWNLOAD_KINDS.MONTHLY]: 'Monthly',
  [DOWNLOAD_KINDS.TEST]: 'Test',
  [DOWNLOAD_KINDS.EVERY_TEST]: 'Every test',
  [DOWNLOAD_KINDS.TOPICS]: 'Topic-wise accuracy',
};

/** What the second control picks, for the kinds that have one. */
export const DOWNLOAD_CHOICE_LABELS: Readonly<Partial<Record<DownloadKind, string>>> = {
  [DOWNLOAD_KINDS.WEEKLY]: 'Week',
  [DOWNLOAD_KINDS.MONTHLY]: 'Month',
  [DOWNLOAD_KINDS.TEST]: 'Test',
};

export const downloadKindOf = (held: string): DownloadKind =>
  (Object.values(DOWNLOAD_KINDS) as string[]).includes(held)
    ? (held as DownloadKind)
    : DOWNLOAD_KINDS.WEEKLY;

export interface DownloadChoice {
  /** Empty for the newest, so an untouched screen has nothing set and nothing to clear. */
  value: string;
  label: string;
}

/** How far back a week or a month is offered. */
const PERIODS_BACK = 12;

const PERIOD_STEPS = {
  [DOWNLOAD_KINDS.WEEKLY]: {
    now: REPORT_PERIODS.THIS_WEEK,
    before: REPORT_PERIODS.LAST_WEEK,
    names: ['This week', 'Last week'],
  },
  [DOWNLOAD_KINDS.MONTHLY]: {
    now: REPORT_PERIODS.THIS_MONTH,
    before: REPORT_PERIODS.LAST_MONTH,
    names: ['This month', 'Last month'],
  },
} as const;
type PeriodKind = keyof typeof PERIOD_STEPS;

const datesOf = (range: ReportPeriodRange): string =>
  `${instituteDayLabel(range.from)} to ${instituteDayLabel(range.to)}`;

/** The weeks or the months on offer, newest first, each valued by the day it starts on. */
function periodChoices(kind: PeriodKind, today: string): DownloadChoice[] {
  const { now, before, names } = PERIOD_STEPS[kind];
  const choices: DownloadChoice[] = [];
  let range = reportPeriodOf(now, today);
  for (let back = 0; back < PERIODS_BACK; back += 1) {
    const name = names[back];
    choices.push({
      value: back === 0 ? '' : range.from,
      label: name ? `${name} · ${datesOf(range)}` : datesOf(range),
    });
    range = reportPeriodOf(before, range.from);
  }
  return choices;
}

const UNTITLED = 'Untitled test';

const newestFirst = (sittings: readonly SatSitting[]): SatSitting[] => [...sittings].reverse();

const sittingLabel = (sitting: SatSitting): string =>
  [
    sitting.testTitle ?? UNTITLED,
    sitting.submittedAt === null ? null : instituteDayLabel(sitting.submittedAt),
    `${sitting.score} / ${sitting.maxMarks}`,
  ]
    .filter((part) => part !== null)
    .join(' · ');

/** What the second control offers for a kind: its weeks, its months or the student's marked sittings. */
export function downloadChoices(
  kind: DownloadKind,
  sittings: readonly SatSitting[],
  today = todayISO(),
): DownloadChoice[] {
  if (kind === DOWNLOAD_KINDS.WEEKLY || kind === DOWNLOAD_KINDS.MONTHLY) {
    return periodChoices(kind, today);
  }
  if (kind !== DOWNLOAD_KINDS.TEST) return [];
  return newestFirst(sittings).map((sitting, at) => ({
    value: at === 0 ? '' : sitting.attemptId,
    label: sittingLabel(sitting),
  }));
}

export interface DownloadAsk {
  key: StudentReportKey;
  query: ReportQueryInput;
}

/** A day typed into an address is read as today rather than thrown on. */
const dayOr = (held: string, today: string): string =>
  dateOnlySchema.safeParse(held).success ? held : today;

/** What a kind and its choice ask the API for; null while a test report has no marked sitting to name. */
export function downloadOf(
  kind: DownloadKind,
  chosen: string,
  sittings: readonly SatSitting[],
  today = todayISO(),
): DownloadAsk | null {
  switch (kind) {
    case DOWNLOAD_KINDS.WEEKLY:
      return {
        key: REPORT_KEYS.STUDENT_WEEKLY,
        query: { ...reportPeriodOf(REPORT_PERIODS.THIS_WEEK, dayOr(chosen, today)) },
      };
    case DOWNLOAD_KINDS.MONTHLY:
      return {
        key: REPORT_KEYS.STUDENT_MONTHLY,
        query: { ...reportPeriodOf(REPORT_PERIODS.THIS_MONTH, dayOr(chosen, today)) },
      };
    case DOWNLOAD_KINDS.TEST: {
      const held = newestFirst(sittings);
      const attemptId = (held.find((sitting) => sitting.attemptId === chosen) ?? held[0])
        ?.attemptId;
      return attemptId ? { key: REPORT_KEYS.STUDENT_SCORE_CARD, query: { attemptId } } : null;
    }
    case DOWNLOAD_KINDS.EVERY_TEST:
      return { key: REPORT_KEYS.STUDENT_CUMULATIVE, query: {} };
    default:
      return { key: REPORT_KEYS.STUDENT_TOPICS, query: {} };
  }
}
