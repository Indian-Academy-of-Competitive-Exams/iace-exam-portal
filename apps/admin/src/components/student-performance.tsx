import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  EVALUATION_MODE,
  FEATURE_KEYS,
  PERFORMANCE_SCOPES,
  paperCounts,
  sittingLabel,
  type CohortCurve,
  type EvaluationMode,
  type PerformanceReport,
  type PerformanceReportQueryInput,
  type PerformanceScope,
} from '@iace/contracts';
import {
  CohortFigure,
  DifficultyFigure,
  MarksFigure,
  SectionsFigure,
  TimeFigure,
  TrajectoryFigure,
} from '@iace/app-kit/browser';
import { Alert, Badge, Combobox, Field, FormSection, Skeleton, plural } from '@iace/ui';
import { api } from '../lib/api';
import {
  PERFORMANCE_SCOPE_LABELS,
  studentReportQueryKey,
  studentSharesQueryKey,
} from '../lib/constants';
import { useAuth } from '../providers/auth';

const SCOPE_ITEMS = Object.entries(PERFORMANCE_SCOPE_LABELS).map(([value, label]) => ({
  value,
  label,
}));

const STUDENT_MARKER = 'This student';

function queryFor(scope: PerformanceScope, scopeId: string): PerformanceReportQueryInput {
  if (scope === PERFORMANCE_SCOPES.ATTEMPT) return { scope, attemptId: scopeId };
  return { scope: PERFORMANCE_SCOPES.ALL_TIME };
}

/** The same figures the student reads, over the same payload, for a student an admin may see. */
export function StudentPerformancePanel({ studentId }: Readonly<{ studentId: string }>) {
  const { can } = useAuth();
  const [scope, setScope] = useState<PerformanceScope>(PERFORMANCE_SCOPES.ATTEMPT);
  const [picked, setPicked] = useState('');

  const canRead = can(FEATURE_KEYS.STUDENT_PERFORMANCE);

  const held = useQuery({
    queryKey: studentSharesQueryKey(studentId),
    queryFn: () => api.admin.students.performanceShares(studentId),
    enabled: canRead,
  });
  const sittings = held.data?.sittings ?? [];
  const attemptId = sittings.some((row) => row.attemptId === picked)
    ? picked
    : (sittings[0]?.attemptId ?? '');

  const onOneSitting = scope === PERFORMANCE_SCOPES.ATTEMPT;
  const scopeId = onOneSitting ? attemptId : '';
  const report = useQuery({
    queryKey: studentReportQueryKey(studentId, scope, scopeId),
    queryFn: () => api.admin.students.performance(studentId, queryFor(scope, scopeId)),
    enabled: canRead && (!onOneSitting || attemptId !== ''),
  });

  if (!canRead) return null;

  return (
    <FormSection
      title="Performance"
      meta={report.data ? plural(report.data.attemptsCounted, 'sitting') : undefined}
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end gap-3">
          {onOneSitting ? (
            <Field htmlFor="reportSitting" label="Sitting" className="min-w-56 flex-1">
              {({ id, 'aria-describedby': describedBy }) => (
                <Combobox
                  id={id}
                  aria-describedby={describedBy}
                  clearable={false}
                  value={attemptId}
                  onChange={setPicked}
                  placeholder="Choose a sitting"
                  items={sittings.map((row) => ({
                    value: row.attemptId,
                    label: sittingLabel(row),
                  }))}
                />
              )}
            </Field>
          ) : null}

          <Field htmlFor="reportScope" label="Scope" className="min-w-44">
            {({ id, 'aria-describedby': describedBy }) => (
              <Combobox
                id={id}
                aria-describedby={describedBy}
                clearable={false}
                value={scope}
                onChange={(next) => setScope(next as PerformanceScope)}
                items={SCOPE_ITEMS}
              />
            )}
          </Field>

          <ModeBadge mode={report.data?.evaluationMode ?? null} />
        </div>

        <Body
          sittingsLoading={held.isLoading}
          sittingsFailed={held.isError}
          sittingCount={sittings.length}
          report={report}
          onOneSitting={onOneSitting}
        />
      </div>
    </FormSection>
  );
}

interface ReportQueryState {
  isError: boolean;
  data?: PerformanceReport;
}

/** Loading, failed and empty are three facts; a read that errored never reads as "nothing here". */
function Body({
  sittingsLoading,
  sittingsFailed,
  sittingCount,
  report,
  onOneSitting,
}: Readonly<{
  sittingsLoading: boolean;
  sittingsFailed: boolean;
  sittingCount: number;
  report: ReportQueryState;
  onOneSitting: boolean;
}>) {
  if (sittingsLoading) return <FiguresSkeleton />;
  if (sittingsFailed) return <Alert variant="danger">This student's sittings did not load.</Alert>;
  if (sittingCount === 0) {
    return <Alert variant="info">This student has not sat an evaluated test.</Alert>;
  }

  if (report.isError) return <Alert variant="danger">This report did not load.</Alert>;
  if (!report.data) return <FiguresSkeleton />;

  return <Figures report={report.data} onOneSitting={onOneSitting} />;
}

function Figures({
  report,
  onOneSitting,
}: Readonly<{ report: PerformanceReport; onOneSitting: boolean }>) {
  const counts = paperCounts(report.sections);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <TrajectoryFigure trajectory={report.trajectory} />
        <Standing cohort={report.cohort} onOneSitting={onOneSitting} />
      </div>

      <MarksFigure composition={report.composition} counts={counts} />

      <div className="grid gap-4 lg:grid-cols-2">
        {report.sections.length > 0 ? <SectionsFigure sections={report.sections} /> : null}
        <DifficultyFigure difficulty={report.difficulty} />
      </div>

      <TimeFigure time={report.time} counts={counts} />
    </div>
  );
}

/** A curve is one paper's, and only once a cohort has been counted — an absence is never a zero. */
function Standing({
  cohort,
  onOneSitting,
}: Readonly<{ cohort: CohortCurve | null; onOneSitting: boolean }>) {
  if (cohort !== null && cohort.bands.length > 0) {
    return <CohortFigure cohort={cohort} youLabel={STUDENT_MARKER} />;
  }
  if (onOneSitting) {
    return <Alert variant="info">No cohort has been counted for this paper yet.</Alert>;
  }
  return <Alert variant="info">A cohort curve is one paper&apos;s; All time spans several.</Alert>;
}

function ModeBadge({ mode }: Readonly<{ mode: EvaluationMode | null }>) {
  if (mode === null) return null;
  const ranked = mode === EVALUATION_MODE.RANKED;
  return <Badge variant={ranked ? 'success' : 'neutral'}>{ranked ? 'Ranked' : 'Practice'}</Badge>;
}

function FiguresSkeleton() {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Skeleton variant="kpi" className="h-56" />
      <Skeleton variant="kpi" className="h-56" />
    </div>
  );
}
