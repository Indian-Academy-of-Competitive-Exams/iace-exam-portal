import * as React from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ClipboardList, Layers } from 'lucide-react';
import {
  Alert,
  Badge,
  Button,
  Combobox,
  EmptyState,
  LoadingState,
  PageFrame,
  PageHeader,
  plural,
} from '@iace/ui';
import {
  EVALUATION_MODE,
  paperCounts,
  PERFORMANCE_SCOPES,
  sittingsOf,
  testsSat,
  type CohortCurve,
  type EvaluationMode,
  type PercentilePoint,
  type PerformancePoint,
  type PerformanceReport,
  type PerformanceReportQueryInput,
  type PerformanceScope,
  type SatSeries,
  type SatTest,
} from '@iace/contracts';
import {
  CohortFigure,
  DifficultyFigure,
  MarksFigure,
  SectionsFigure,
  TimeFigure,
  TrajectoryFigure,
} from '@iace/app-kit/browser';
import { api } from '../lib/api';
import {
  PERFORMANCE_QUERY_KEY,
  PERFORMANCE_SCOPE_LABELS,
  PERFORMANCE_SERIES_QUERY_KEY,
  PICKER_WIDTH,
  ROUTES,
  performanceReportQueryKey,
} from '../lib/constants';
import { AttemptCompare } from '../components/performance/attempt-compare';
import { MasteryFigure, RampFigure } from '../components/performance/progression-figures';
import { ShareLinks } from '../components/performance/share-links';

const SCOPE_ITEMS = Object.entries(PERFORMANCE_SCOPE_LABELS).map(([value, label]) => ({
  value,
  label,
}));

const UNTITLED = 'Untitled test';

/** Each scope is answered by its own id, and never by one left over from the scope before it. */
function scopeIdFor(scope: PerformanceScope, testId: string, seriesId: string): string {
  if (scope === PERFORMANCE_SCOPES.TEST) return testId;
  if (scope === PERFORMANCE_SCOPES.SERIES) return seriesId;
  return '';
}

function queryFor(scope: PerformanceScope, scopeId: string): PerformanceReportQueryInput {
  if (scope === PERFORMANCE_SCOPES.TEST) return { scope, testId: scopeId };
  if (scope === PERFORMANCE_SCOPES.SERIES) return { scope, seriesId: scopeId };
  return { scope: PERFORMANCE_SCOPES.ALL_TIME };
}

export function PerformancePage() {
  const [scope, setScope] = React.useState<PerformanceScope>(PERFORMANCE_SCOPES.TEST);
  const [picked, setPicked] = React.useState('');
  const [pickedSeries, setPickedSeries] = React.useState('');

  const trend = useQuery({ queryKey: PERFORMANCE_QUERY_KEY, queryFn: () => api.me.performance() });
  const points = trend.data?.points ?? [];
  const sat = testsSat(points);
  // The screen opens on the paper sat most recently, which is the first row the picker offers.
  const testId = sat.some((test) => test.testId === picked) ? picked : (sat[0]?.testId ?? '');

  const onSeries = scope === PERFORMANCE_SCOPES.SERIES;
  const series = useQuery({
    queryKey: PERFORMANCE_SERIES_QUERY_KEY,
    queryFn: () => api.me.performanceSeries(),
    enabled: onSeries,
  });
  const seriesRows = series.data ?? [];
  const seriesId = seriesRows.some((row) => row.id === pickedSeries)
    ? pickedSeries
    : (seriesRows[0]?.id ?? '');

  const onOneTest = scope === PERFORMANCE_SCOPES.TEST;
  const scopeId = scopeIdFor(scope, testId, seriesId);
  const report = useQuery({
    queryKey: performanceReportQueryKey(scope, scopeId),
    queryFn: () => api.me.performanceReport(queryFor(scope, scopeId)),
    enabled: scope === PERFORMANCE_SCOPES.ALL_TIME || scopeId !== '',
  });

  return (
    <PageFrame
      header={
        <PageHeader
          title="Performance"
          meta={reportMeta(trend.data?.testsSat, report.data?.evaluationMode ?? null)}
          action={
            <Pickers
              tests={sat}
              testId={testId}
              onPickTest={setPicked}
              series={seriesRows}
              seriesId={seriesId}
              onPickSeries={setPickedSeries}
              scope={scope}
              onPickScope={setScope}
            />
          }
        />
      }
    >
      <Body
        trend={trend}
        series={series}
        report={report}
        points={points}
        testId={testId}
        onOneTest={onOneTest}
        onSeries={onSeries}
      />
    </PageFrame>
  );
}

interface QueryState {
  isLoading: boolean;
  isError: boolean;
}

/** Loading, failed and empty are three different facts; a failed read never reads as "nothing". */
function Body({
  trend,
  series,
  report,
  points,
  testId,
  onOneTest,
  onSeries,
}: Readonly<{
  trend: QueryState;
  series: QueryState & { data?: SatSeries[] };
  report: QueryState & { data?: PerformanceReport };
  points: readonly PerformancePoint[];
  testId: string;
  onOneTest: boolean;
  onSeries: boolean;
}>) {
  if (trend.isLoading) return <LoadingState />;
  if (trend.isError) return <Alert variant="danger">Your performance did not load.</Alert>;
  if (points.length === 0) {
    return (
      <EmptyState
        icon={ClipboardList}
        title="No tests sat yet"
        action={
          <Button asChild>
            <Link to={ROUTES.TESTS}>Go to your tests</Link>
          </Button>
        }
      />
    );
  }

  if (onSeries) {
    if (series.isError) return <Alert variant="danger">Your test series did not load.</Alert>;
    if (series.data?.length === 0) return <EmptyState icon={Layers} title="No test series sat" />;
  }

  if (report.isError) return <Alert variant="danger">This report did not load.</Alert>;
  if (!report.data) return <LoadingState />;

  return (
    <Report
      report={report.data}
      sittings={onOneTest ? sittingsOf(points, testId) : []}
      onOneTest={onOneTest}
    />
  );
}

/** The paper decides the shape: a ranked one is read against a cohort, a practice one against itself. */
function Report({
  report,
  sittings,
  onOneTest,
}: Readonly<{
  report: PerformanceReport;
  sittings: readonly PerformancePoint[];
  onOneTest: boolean;
}>) {
  const counts = paperCounts(report.sections);
  const practice = report.evaluationMode === EVALUATION_MODE.PRACTICE && onOneTest;

  return (
    <div className="flex flex-col gap-8 pb-8">
      {report.progression ? (
        <Alert variant="info">
          This series steps up in difficulty. A percentile that holds while the papers harden is a
          gain, not a plateau.
        </Alert>
      ) : null}

      {practice ? (
        <AttemptCompare sittings={sittings} cohort={report.cohort} />
      ) : (
        <StandingRow trajectory={report.trajectory} cohort={report.cohort} />
      )}

      {report.progression ? (
        <>
          <RampFigure progression={report.progression} />
          {report.progression.subjects.length > 0 ? (
            <MasteryFigure subjects={report.progression.subjects} />
          ) : null}
        </>
      ) : null}

      <MarksFigure composition={report.composition} counts={counts} />

      <div className="grid items-start gap-4 lg:grid-cols-2">
        {report.sections.length > 0 ? <SectionsFigure sections={report.sections} /> : null}
        <DifficultyFigure difficulty={report.difficulty} />
      </div>

      <TimeFigure time={report.time} counts={counts} />

      <ShareLinks />
    </div>
  );
}

/** A curve exists only where one paper's cohort drew one, and only once a rollup has bands. */
function StandingRow({
  trajectory,
  cohort,
}: Readonly<{ trajectory: readonly PercentilePoint[]; cohort: CohortCurve | null }>) {
  const curve = cohort !== null && cohort.bands.length > 0 ? cohort : null;

  return (
    <div className="grid items-start gap-4 lg:grid-cols-2">
      <TrajectoryFigure trajectory={trajectory} />
      {curve ? <CohortFigure cohort={curve} /> : null}
    </div>
  );
}

/** What the report is OF, chosen in the header: which paper or series, and how far back to read. */
function Pickers({
  tests,
  testId,
  onPickTest,
  series,
  seriesId,
  onPickSeries,
  scope,
  onPickScope,
}: Readonly<{
  tests: readonly SatTest[];
  testId: string;
  onPickTest: (testId: string) => void;
  series: readonly SatSeries[];
  seriesId: string;
  onPickSeries: (seriesId: string) => void;
  scope: PerformanceScope;
  onPickScope: (scope: PerformanceScope) => void;
}>) {
  if (tests.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {scope === PERFORMANCE_SCOPES.TEST ? (
        <Combobox
          className={PICKER_WIDTH.RECORD}
          items={tests.map((test) => ({ value: test.testId, label: test.title ?? UNTITLED }))}
          value={testId}
          onChange={onPickTest}
          clearable={false}
          aria-label="Test"
        />
      ) : null}
      {scope === PERFORMANCE_SCOPES.SERIES && series.length > 0 ? (
        <Combobox
          className={PICKER_WIDTH.RECORD}
          items={series.map((row) => ({ value: row.id, label: row.name }))}
          value={seriesId}
          onChange={onPickSeries}
          clearable={false}
          aria-label="Series"
        />
      ) : null}
      <Combobox
        className={PICKER_WIDTH.SCOPE}
        items={SCOPE_ITEMS}
        value={scope}
        onChange={(next) => onPickScope(next as PerformanceScope)}
        clearable={false}
        aria-label="Scope"
      />
    </div>
  );
}

/** How the paper is marked is a fact about the record, so it rides beside the count, not the pickers. */
function reportMeta(testsSat: number | undefined, mode: EvaluationMode | null) {
  if (testsSat === undefined && mode === null) return undefined;
  const ranked = mode === EVALUATION_MODE.RANKED;

  return (
    <span className="inline-flex items-center gap-2">
      {testsSat === undefined ? null : plural(testsSat, 'test')}
      {mode === null ? null : (
        <Badge variant={ranked ? 'success' : 'neutral'}>{ranked ? 'Ranked' : 'Practice'}</Badge>
      )}
    </span>
  );
}
