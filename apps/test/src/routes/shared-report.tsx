import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { BadgeCheck } from 'lucide-react';
import { AppException, ErrorCodes, INSTITUTE_TIME_ZONE, type SharedReport } from '@iace/contracts';
import {
  Alert,
  Avatar,
  Badge,
  Brandmark,
  ChartFigure,
  DistributionPlot,
  LoadingState,
  MeasureBars,
  Metric,
  MetricGroup,
  ThemeToggle,
  plural,
  type DistributionMarker,
  type MeasureBar,
} from '@iace/ui';
import { api } from '../lib/api';
import { sharedReportQueryKey } from '../lib/constants';

const UNMEASURED = '—';

const satOn = new Intl.DateTimeFormat('en-IN', {
  timeZone: INSTITUTE_TIME_ZONE,
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

/** The one screen served without a session, so it carries no app navigation and no second student. */
export function SharedReportPage() {
  const { token = '' } = useParams();
  const report = useQuery({
    queryKey: sharedReportQueryKey(token),
    queryFn: () => api.sharedReport(token),
    retry: false,
  });

  return (
    <div className="flex h-dvh flex-col bg-background">
      <header className="flex-none border-b border-border bg-card">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-4 px-5 py-3">
          <Brandmark portal="Performance report" />
          <div className="flex items-center gap-2">
            <Badge variant="success">
              <BadgeCheck aria-hidden />
              Verified result
            </Badge>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <div className="relative min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-5 pb-12 pt-7">
          <Body query={report} />
        </div>
      </div>
    </div>
  );
}

function Body({
  query,
}: Readonly<{
  query: { isLoading: boolean; isError: boolean; error: unknown; data?: SharedReport };
}>) {
  if (query.isLoading) return <LoadingState />;

  if (query.isError || !query.data) {
    const refusal = AppException.is(query.error) ? query.error : null;
    return refusal?.code === ErrorCodes.NOT_FOUND ? (
      <Alert variant="warning">
        This link has been revoked or has expired. Ask the student for a new one.
      </Alert>
    ) : (
      <Alert variant="danger">This report did not load. Try again in a moment.</Alert>
    );
  }

  return <Report report={query.data} />;
}

function Report({ report }: Readonly<{ report: SharedReport }>) {
  return (
    <div className="flex flex-col gap-6">
      <Identity report={report} />
      <Headline report={report} />
      {report.bands.length > 0 ? <Cohort report={report} /> : null}
      {report.sections.length > 0 ? <Sections report={report} /> : null}
      <Alert variant="info">
        A report the student shared. It shows their own result only — no answer key and no other
        student — and they can revoke this link at any time.
      </Alert>
    </div>
  );
}

function Identity({ report }: Readonly<{ report: SharedReport }>) {
  const sat = report.submittedAt === null ? null : satOn.format(new Date(report.submittedAt));
  const meta = [report.testTitle, report.branchName, sat].filter(Boolean).join(' · ');

  return (
    <div className="flex items-center gap-4">
      <Avatar name={report.studentName} size="lg" className="size-14 text-lg" />
      <div className="min-w-0">
        <h1 className="truncate text-2xl font-bold tracking-tight">
          {report.studentName ?? 'IACE student'}
        </h1>
        {meta ? <div className="mt-0.5 truncate text-sm text-muted-foreground">{meta}</div> : null}
      </div>
    </div>
  );
}

function Headline({ report }: Readonly<{ report: SharedReport }>) {
  return (
    <div className="rounded-lg border border-border bg-card p-6">
      <MetricGroup>
        <Metric label="Score" value={report.score} unit={`/ ${report.maxMarks}`} />
        <Metric
          label="Rank"
          value={report.rank === null ? UNMEASURED : `#${report.rank}`}
          unit={report.cohortSize > 0 ? `of ${report.cohortSize}` : undefined}
        />
        <Metric
          label="Percentile"
          value={report.percentile ?? UNMEASURED}
          unit={report.percentile === null ? undefined : 'th'}
        />
      </MetricGroup>
    </div>
  );
}

/** Bands and counts — the same curve the signed-in screen draws, with nobody named on it. */
function Cohort({ report }: Readonly<{ report: SharedReport }>) {
  const markers: DistributionMarker[] = [
    { key: 'you', label: report.studentName ?? 'This student', value: report.score, tone: 'you' },
  ];
  if (report.averageScore !== null) {
    markers.push({
      key: 'average',
      label: 'Average',
      value: report.averageScore,
      tone: 'neutral',
    });
  }
  if (report.topperScore !== null) {
    markers.push({ key: 'top', label: 'Top', value: report.topperScore, tone: 'good' });
  }

  return (
    <ChartFigure title="Cohort standing" meta={plural(report.cohortSize, 'sitting')}>
      <DistributionPlot
        bands={report.bands}
        markers={markers}
        min={report.bands[0]?.from ?? 0}
        max={report.bands.at(-1)?.to ?? report.score}
        axisSuffix="marks"
        countLabel="Sittings"
        aria-label="Where this sitting sits in the cohort's score distribution"
      />
    </ChartFigure>
  );
}

function Sections({ report }: Readonly<{ report: SharedReport }>) {
  const bars: MeasureBar[] = report.sections.map((section) => ({
    key: section.name,
    label: section.name,
    value: section.score,
    display: `${section.score} / ${section.maxMarks}`,
  }));
  const ceiling = Math.max(...report.sections.map((section) => section.maxMarks), 1);

  return (
    <ChartFigure title="Sections" meta={plural(report.sections.length, 'section')}>
      <MeasureBars bars={bars} max={ceiling} />
    </ChartFigure>
  );
}
