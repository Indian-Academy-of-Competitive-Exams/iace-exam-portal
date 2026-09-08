import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Alert, Badge, DataTable, TruncatedText, plural, type DataTableColumn } from '@iace/ui';
import { SectionsFigure } from '@iace/app-kit/browser';
import {
  PERFORMANCE_SCOPES,
  type PerformanceReport,
  type SectionalStanding,
} from '@iace/contracts';
import { api } from '../lib/api';
import { performanceReportQueryKey } from '../lib/constants';
import { PageBody, ReportSkeleton, Section } from '../components/ui';

const DASH = '—';

/** Where a section stands against the field. A cutoff would be a line; this is a position. */
const STANDINGS = {
  ABOVE: { label: 'Above average', variant: 'success' },
  LEVEL: { label: 'At average', variant: 'neutral' },
  BELOW: { label: 'Below average', variant: 'warning' },
  NONE: { label: DASH, variant: 'neutral' },
} as const;

export function SubjectPanel() {
  const { attemptId = '' } = useParams();
  const report = useQuery({
    queryKey: performanceReportQueryKey(PERFORMANCE_SCOPES.ATTEMPT, attemptId),
    queryFn: () => api.me.performanceReport({ scope: PERFORMANCE_SCOPES.ATTEMPT, attemptId }),
  });

  return (
    <>
      {report.isLoading ? <ReportSkeleton /> : null}
      {report.data ? <Body report={report.data} /> : null}
    </>
  );
}

function Body({ report }: Readonly<{ report: PerformanceReport }>) {
  const measured = report.sections.some((section) => section.cohortSampleSize > 0);

  return (
    <PageBody>
      {measured ? null : (
        /* ui-copy-ok: consequence */
        <Alert variant="info">
          No average has been counted for this paper yet, so the columns comparing you to everyone
          else are empty.
        </Alert>
      )}

      <Section title="Sections" meta={plural(report.sections.length, 'section')}>
        <DataTable
          columns={COLUMNS}
          rows={report.sections}
          rowKey={(row) => row.baseConfigSectionId}
          isLoading={false}
          empty="This paper had no sections."
        />
      </Section>

      {measured ? <SectionsFigure sections={report.sections} /> : null}
    </PageBody>
  );
}

const COLUMNS: readonly DataTableColumn<SectionalStanding>[] = [
  {
    key: 'name',
    header: 'Section',
    className: 'max-w-[14rem]',
    cell: (row) => <TruncatedText>{row.name}</TruncatedText>,
  },
  { key: 'marks', header: 'Marks', cell: (row) => `${row.score} / ${row.maxMarks}` },
  { key: 'correct', header: 'Correct', numeric: true, cell: (row) => row.correctCount },
  { key: 'wrong', header: 'Wrong', numeric: true, cell: (row) => row.wrongCount },
  { key: 'left', header: 'Unattempted', numeric: true, cell: (row) => row.unattemptedCount },
  { key: 'yourTime', header: 'Your time', numeric: true, cell: (row) => minutes(row.timeSpentSec) },
  {
    key: 'cohortTime',
    header: 'Average time',
    numeric: true,
    cell: (row) => minutes(row.cohortAverageTimeSec),
  },
  {
    key: 'topperTime',
    header: 'Topper time',
    numeric: true,
    cell: (row) => minutes(row.topperTimeSec),
  },
  {
    key: 'rate',
    header: 'Marks a minute',
    numeric: true,
    cell: (row) => perMinute(row.score, row.timeSpentSec),
  },
  {
    key: 'cohortRate',
    header: 'Average a minute',
    numeric: true,
    cell: (row) => perMinute(row.cohortAverageScore, row.cohortAverageTimeSec),
  },
  {
    key: 'standing',
    header: 'Against average',
    cell: (row) => {
      const held = standingOf(row);
      return <Badge variant={held.variant}>{held.label}</Badge>;
    },
  },
];

function standingOf(row: SectionalStanding) {
  if (row.cohortAverageScore === null) return STANDINGS.NONE;
  if (row.score > row.cohortAverageScore) return STANDINGS.ABOVE;
  return row.score < row.cohortAverageScore ? STANDINGS.BELOW : STANDINGS.LEVEL;
}

/** What a minute in this section actually bought — the one figure that crosses marks with time. */
function perMinute(score: number | null, seconds: number | null): string {
  if (score === null || seconds === null || seconds === 0) return DASH;
  return (Math.round((score / (seconds / 60)) * 100) / 100).toFixed(2);
}

/** Seconds read as minutes on a result screen; nobody counts a paper in seconds. */
function minutes(seconds: number | null): string {
  if (seconds === null) return DASH;
  const whole = Math.floor(seconds / 60);
  return whole === 0 ? `${seconds}s` : `${whole}m`;
}
