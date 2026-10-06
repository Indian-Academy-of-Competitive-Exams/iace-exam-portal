/** What a student can take away of their own record: the same list on the web and on the phone. */
import {
  REPORT_KEYS,
  REPORT_PERIODS,
  instituteDayLabel,
  reportPeriodOf,
  todayISO,
  type ReportPeriod,
  type ReportQueryInput,
  type SatSitting,
  type StudentReportKey,
} from '@iace/contracts';

export interface ReportDownload {
  id: string;
  key: StudentReportKey;
  title: string;
  /** The values behind the title: its dates, or its marks. */
  meta: string | null;
  query: ReportQueryInput;
}

const PERIOD_DOWNLOADS: readonly { period: ReportPeriod; key: StudentReportKey; title: string }[] =
  [
    { period: REPORT_PERIODS.THIS_WEEK, key: REPORT_KEYS.STUDENT_WEEKLY, title: 'This week' },
    { period: REPORT_PERIODS.LAST_WEEK, key: REPORT_KEYS.STUDENT_WEEKLY, title: 'Last week' },
    { period: REPORT_PERIODS.THIS_MONTH, key: REPORT_KEYS.STUDENT_MONTHLY, title: 'This month' },
    { period: REPORT_PERIODS.LAST_MONTH, key: REPORT_KEYS.STUDENT_MONTHLY, title: 'Last month' },
  ];

const UNTITLED = 'Untitled test';

/** Each named period, then the two reports that span every sitting. */
export function progressDownloads(today = todayISO()): ReportDownload[] {
  const periods = PERIOD_DOWNLOADS.map(({ period, key, title }) => {
    const range = reportPeriodOf(period, today);
    return {
      id: period,
      key,
      title,
      meta: `${instituteDayLabel(range.from)} to ${instituteDayLabel(range.to)}`,
      query: { ...range },
    };
  });
  return [
    ...periods,
    {
      id: 'cumulative',
      key: REPORT_KEYS.STUDENT_CUMULATIVE,
      title: 'Every test',
      meta: null,
      query: {},
    },
    {
      id: 'topics',
      key: REPORT_KEYS.STUDENT_TOPICS,
      title: 'Topic-wise accuracy',
      meta: null,
      query: {},
    },
  ];
}

/** One score card a marked sitting, the newest first. */
export function scoreCardDownloads(sittings: readonly SatSitting[]): ReportDownload[] {
  return [...sittings].reverse().map((sitting) => ({
    id: sitting.attemptId,
    key: REPORT_KEYS.STUDENT_SCORE_CARD,
    title: sitting.testTitle ?? UNTITLED,
    meta: [
      sitting.submittedAt === null ? null : instituteDayLabel(sitting.submittedAt),
      `${sitting.score} / ${sitting.maxMarks}`,
    ]
      .filter((part) => part !== null)
      .join(' · '),
    query: { attemptId: sitting.attemptId },
  }));
}
