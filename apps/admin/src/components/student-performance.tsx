import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useInfinitePages } from '@iace/app-kit';
import {
  EVALUATION_MODE,
  EVALUATION_MODE_LABELS,
  FEATURE_KEYS,
  PAGE_SIZE_MAX,
  PERFORMANCE_SCOPES,
  paperCounts,
  sittingLabel,
  type CohortCurve,
  type EvaluationMode,
  type PerformanceReport,
  type PerformanceReportQueryInput,
  type PerformanceScope,
  type ReportSitting,
} from '@iace/contracts';
import {
  CohortFigure,
  DifficultyFigure,
  MarksFigure,
  SectionsFigure,
  TimeFigure,
  TrajectoryFigure,
} from '@iace/app-kit/browser';
import {
  Badge,
  Combobox,
  EmptyState,
  EMPTY_STATE_KINDS,
  Field,
  FormSection,
  Skeleton,
  plural,
} from '@iace/ui';
import { api } from '../lib/api';
import {
  PERFORMANCE_SCOPE_LABELS,
  studentReportQueryKey,
  studentSittingsQueryKey,
} from '../lib/constants';
import { useAuth } from '../providers/auth';

const SCOPE_ITEMS = Object.entries(PERFORMANCE_SCOPE_LABELS).map(([value, label]) => ({
  value,
  label,
}));

const STUDENT_MARKER = 'This student';

const NO_SEARCH = '';

function queryFor(scope: PerformanceScope, scopeId: string): PerformanceReportQueryInput {
  if (scope === PERFORMANCE_SCOPES.ATTEMPT) return { scope, attemptId: scopeId };
  return { scope: PERFORMANCE_SCOPES.ALL_TIME };
}

// Its own list, paged: the share endpoint caps at what a LINK may open, which is a different rule.
function useSittings(studentId: string, search: string, enabled: boolean) {
  return useInfinitePages({
    queryKey: studentSittingsQueryKey(studentId, search),
    fetchPage: (page) =>
      api.admin.students.sittings(studentId, { page, pageSize: PAGE_SIZE_MAX, q: search }),
    enabled,
  });
}

/** The same figures the student reads, over the same payload, for a student an admin may see. */
export function StudentPerformancePanel({ studentId }: Readonly<{ studentId: string }>) {
  const { can } = useAuth();
  const [scope, setScope] = useState<PerformanceScope>(PERFORMANCE_SCOPES.ATTEMPT);
  const [search, setSearch] = useState(NO_SEARCH);
  const [picked, setPicked] = useState<ReportSitting | null>(null);

  const canRead = can(FEATURE_KEYS.STUDENT_PERFORMANCE);

  // Unsearched, so typing in the picker never swaps the open report or reads as "no sitting yet".
  const held = useSittings(studentId, NO_SEARCH, canRead);
  const found = useSittings(studentId, search, canRead);
  const sitting = picked ?? held.items[0] ?? null;
  const attemptId = sitting?.attemptId ?? '';

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
                  selectedLabel={sitting ? sittingLabel(sitting) : undefined}
                  onChange={(next) =>
                    setPicked(found.items.find((row) => row.attemptId === next) ?? null)
                  }
                  placeholder="Choose a sitting"
                  items={found.items.map((row) => ({
                    value: row.attemptId,
                    label: sittingLabel(row),
                    hint: EVALUATION_MODE_LABELS[row.evaluationMode],
                  }))}
                  search={search}
                  onSearchChange={setSearch}
                  searchPlaceholder="Search tests"
                  hasMore={found.hasMore}
                  onLoadMore={found.loadMore}
                  isLoading={found.isLoading}
                  isLoadingMore={found.isLoadingMore}
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
          onRetrySittings={held.retry}
          sittingCount={held.items.length}
          report={report}
          onOneSitting={onOneSitting}
        />
      </div>
    </FormSection>
  );
}

interface ReportQueryState {
  isError: boolean;
  refetch: () => void;
  data?: PerformanceReport;
}

/** Loading, failed and empty are three facts; a read that errored never reads as "nothing here". */
function Body({
  sittingsLoading,
  sittingsFailed,
  onRetrySittings,
  sittingCount,
  report,
  onOneSitting,
}: Readonly<{
  sittingsLoading: boolean;
  sittingsFailed: boolean;
  onRetrySittings: () => void;
  sittingCount: number;
  report: ReportQueryState;
  onOneSitting: boolean;
}>) {
  if (sittingsLoading) return <FiguresSkeleton />;
  if (sittingsFailed) {
    return (
      <EmptyState
        kind={EMPTY_STATE_KINDS.FAILURE}
        title="This student's sittings did not load"
        onRetry={onRetrySittings}
      />
    );
  }
  if (sittingCount === 0) return <EmptyState title="No evaluated sitting yet" />;

  if (report.isError) {
    return (
      <EmptyState
        kind={EMPTY_STATE_KINDS.FAILURE}
        title="This report did not load"
        onRetry={report.refetch}
      />
    );
  }
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
    return <EmptyState level={3} size="sm" title="No cohort average yet" />;
  }
  return (
    <EmptyState
      level={3}
      size="sm"
      title="No cohort spread"
      // ui-copy-ok: rule — which scope a spread can exist for, invisible from the figure
      hint="A spread is one paper's; All time spans several."
    />
  );
}

function ModeBadge({ mode }: Readonly<{ mode: EvaluationMode | null }>) {
  if (mode === null) return null;
  const ranked = mode === EVALUATION_MODE.RANKED;
  return <Badge variant={ranked ? 'success' : 'neutral'}>{EVALUATION_MODE_LABELS[mode]}</Badge>;
}

function FiguresSkeleton() {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Skeleton variant="kpi" className="h-56" />
      <Skeleton variant="kpi" className="h-56" />
    </div>
  );
}
