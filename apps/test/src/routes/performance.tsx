import * as React from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ClipboardList } from 'lucide-react';
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
  PERFORMANCE_SCOPES,
  sittingsOf,
  testsSat,
  type CohortCurve,
  type EvaluationMode,
  type PercentilePoint,
  type PerformancePoint,
  type PerformanceReport,
  type PerformanceScope,
  type SatTest,
} from '@iace/contracts';
import { api } from '../lib/api';
import {
  PERFORMANCE_QUERY_KEY,
  PERFORMANCE_SCOPE_LABELS,
  ROUTES,
  performanceReportQueryKey,
} from '../lib/constants';
import { AttemptCompare } from '../components/performance/attempt-compare';
import {
  CohortFigure,
  DifficultyFigure,
  MarksFigure,
  SectionsFigure,
  TimeFigure,
  TrajectoryFigure,
} from '../components/performance/report-figures';
import { paperCounts } from '../lib/performance';

const SCOPE_ITEMS = Object.entries(PERFORMANCE_SCOPE_LABELS).map(([value, label]) => ({
  value,
  label,
}));

const UNTITLED = 'Untitled test';

export function PerformancePage() {
  const [scope, setScope] = React.useState<PerformanceScope>(PERFORMANCE_SCOPES.TEST);
  const [picked, setPicked] = React.useState('');

  const trend = useQuery({ queryKey: PERFORMANCE_QUERY_KEY, queryFn: () => api.me.performance() });
  const points = trend.data?.points ?? [];
  const sat = testsSat(points);
  // The screen opens on the paper sat most recently, which is the first row the picker offers.
  const testId = sat.some((test) => test.testId === picked) ? picked : (sat[0]?.testId ?? '');

  const onOneTest = scope === PERFORMANCE_SCOPES.TEST;
  const report = useQuery({
    queryKey: performanceReportQueryKey(scope, onOneTest ? testId : ''),
    queryFn: () =>
      api.me.performanceReport(
        onOneTest ? { scope, testId } : { scope: PERFORMANCE_SCOPES.ALL_TIME },
      ),
    enabled: !onOneTest || testId !== '',
  });

  return (
    <PageFrame
      header={
        <PageHeader
          title="Performance"
          meta={trend.data ? plural(trend.data.testsSat, 'test') : undefined}
          action={
            <Pickers
              tests={sat}
              testId={testId}
              onPickTest={setPicked}
              scope={scope}
              onPickScope={setScope}
              report={report.data}
            />
          }
        />
      }
    >
      <Body trend={trend} report={report} points={points} testId={testId} onOneTest={onOneTest} />
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
  report,
  points,
  testId,
  onOneTest,
}: Readonly<{
  trend: QueryState;
  report: QueryState & { data?: PerformanceReport };
  points: readonly PerformancePoint[];
  testId: string;
  onOneTest: boolean;
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
      {practice ? (
        <AttemptCompare sittings={sittings} cohort={report.cohort} />
      ) : (
        <StandingRow trajectory={report.trajectory} cohort={report.cohort} />
      )}

      <MarksFigure composition={report.composition} counts={counts} />

      <div className="grid gap-4 lg:grid-cols-2">
        {report.sections.length > 0 ? <SectionsFigure sections={report.sections} /> : null}
        <DifficultyFigure difficulty={report.difficulty} />
      </div>

      <TimeFigure time={report.time} counts={counts} />
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
    <div className="grid gap-4 lg:grid-cols-2">
      <TrajectoryFigure trajectory={trajectory} />
      {curve ? <CohortFigure cohort={curve} /> : null}
    </div>
  );
}

/** What the report is OF, chosen in the header: which paper, and how far back to read. */
function Pickers({
  tests,
  testId,
  onPickTest,
  scope,
  onPickScope,
  report,
}: Readonly<{
  tests: readonly SatTest[];
  testId: string;
  onPickTest: (testId: string) => void;
  scope: PerformanceScope;
  onPickScope: (scope: PerformanceScope) => void;
  report?: PerformanceReport;
}>) {
  if (tests.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <ModeBadge mode={report?.evaluationMode ?? null} />
      {scope === PERFORMANCE_SCOPES.TEST ? (
        <Combobox
          items={tests.map((test) => ({ value: test.testId, label: test.title ?? UNTITLED }))}
          value={testId}
          onChange={onPickTest}
          clearable={false}
          aria-label="Test"
        />
      ) : null}
      <Combobox
        items={SCOPE_ITEMS}
        value={scope}
        onChange={(next) => onPickScope(next as PerformanceScope)}
        clearable={false}
        aria-label="Scope"
      />
    </div>
  );
}

function ModeBadge({ mode }: Readonly<{ mode: EvaluationMode | null }>) {
  if (mode === null) return null;
  const ranked = mode === EVALUATION_MODE.RANKED;
  return <Badge variant={ranked ? 'success' : 'neutral'}>{ranked ? 'Ranked' : 'Practice'}</Badge>;
}
