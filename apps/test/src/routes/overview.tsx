import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ClipboardList } from 'lucide-react';
import {
  Alert,
  Button,
  Combobox,
  EmptyState,
  Field,
  LoadingState,
  PageFrame,
  PageHeader,
  SectionHeading,
  SegmentedControl,
} from '@iace/ui';
import {
  DispositionFigure,
  ModeTiles,
  PageCrumbs,
  SpeedAccuracyFigure,
  StandingTiles,
  SubjectStrengthFigure,
} from '@iace/app-kit/browser';
import { newestFirst } from '@iace/app-kit';
import {
  EVALUATION_MODE,
  EVALUATION_MODE_LABELS,
  EVALUATION_MODES,
  INSTITUTE_TIME_ZONE,
  TEST_SCOPE_LABELS,
  scopesSat,
  type EvaluationMode,
  type PerformancePoint,
  type StudentOverview,
  type TestScope,
} from '@iace/contracts';
import { api } from '../lib/api';
import {
  ANY_SCOPE,
  NAV_ITEMS,
  OVERVIEW_QUERY_KEY,
  PERFORMANCE_QUERY_KEY,
  PICKER_WIDTH,
  ROUTES,
} from '../lib/constants';

const UNTITLED = 'Untitled test';

const WHEN = new Intl.DateTimeFormat('en-IN', {
  timeZone: INSTITUTE_TIME_ZONE,
  dateStyle: 'medium',
});

const MODE_ITEMS = EVALUATION_MODES.map((mode) => ({
  value: mode,
  label: EVALUATION_MODE_LABELS[mode],
}));

/** Where Performance opens: the whole career off the two rollup tables, no test chosen. */
export function OverviewPage() {
  const navigate = useNavigate();
  const overview = useQuery({ queryKey: OVERVIEW_QUERY_KEY, queryFn: () => api.me.overview() });
  const trend = useQuery({ queryKey: PERFORMANCE_QUERY_KEY, queryFn: () => api.me.performance() });

  const sat = newestFirst(trend.data?.points ?? []);

  return (
    <PageFrame
      header={
        <PageHeader
          breadcrumbs={<PageCrumbs nav={NAV_ITEMS} />}
          title="Performance"
          meta={overview.data?.standing.lastAttemptAt ? satOn(overview.data) : undefined}
          action={
            sat.length > 0 ? (
              <Combobox
                value=""
                onChange={(attemptId) => navigate(ROUTES.REPORT(attemptId))}
                items={sat.map((point) => ({
                  value: point.attemptId,
                  label: point.testTitle ?? UNTITLED,
                  hint: sittingHint(point),
                }))}
                placeholder="Open one test"
                clearable={false}
                aria-label="Test"
                className={PICKER_WIDTH.REPORT}
              />
            ) : undefined
          }
        />
      }
    >
      {overview.isLoading ? <LoadingState /> : null}
      {overview.isError ? <Alert variant="danger">Your performance did not load.</Alert> : null}
      {overview.data ? <Body overview={overview.data} /> : null}
    </PageFrame>
  );
}

function Body({ overview }: Readonly<{ overview: StudentOverview }>) {
  const [mode, setMode] = useState<EvaluationMode>(EVALUATION_MODE.RANKED);
  const [scope, setScope] = useState<TestScope | null>(null);

  if (overview.standing.testsAttempted === 0) {
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

  const scopes = scopesSat(overview.subjects, mode);
  const chosen = scope !== null && scopes.includes(scope) ? scope : null;
  const view = { subjects: overview.subjects, mode, scope: chosen };

  return (
    <div className="flex flex-col gap-8">
      {overview.standing.testsEvaluated === 0 ? (
        /* ui-copy-ok: consequence */
        <Alert variant="info">
          No ranked test of yours has been marked yet, so there is no percentile or score to stand
          on. Everything below is what your practice has counted.
        </Alert>
      ) : null}

      <StandingTiles standing={overview.standing} />

      <section className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <ModeTiles measure={overview.byMode[mode]} />
          <SegmentedControl
            value={mode}
            onChange={(next) => setMode(next as EvaluationMode)}
            items={MODE_ITEMS}
            aria-label="Evaluation mode"
          />
        </div>

        <DispositionFigure disposition={overview.disposition} />
      </section>

      <section className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <SectionHeading title="Subjects" meta={EVALUATION_MODE_LABELS[mode]} />
          {scopes.length > 1 ? (
            <Field htmlFor="subjectScope" label="Scope" className="min-w-44">
              {({ id, 'aria-describedby': describedBy }) => (
                <Combobox
                  id={id}
                  aria-describedby={describedBy}
                  clearable={false}
                  value={chosen ?? ANY_SCOPE}
                  onChange={(next) => setScope(next === ANY_SCOPE ? null : (next as TestScope))}
                  items={[
                    { value: ANY_SCOPE, label: 'Every scope' },
                    ...scopes.map((value) => ({ value, label: TEST_SCOPE_LABELS[value] })),
                  ]}
                />
              )}
            </Field>
          ) : null}
        </div>

        <div className="grid gap-4 xl:grid-cols-2">
          <SubjectStrengthFigure {...view} />
          <SpeedAccuracyFigure {...view} />
        </div>
      </section>
    </div>
  );
}

const satOn = (overview: StudentOverview) =>
  overview.standing.lastAttemptAt === null
    ? undefined
    : `Last sat ${WHEN.format(new Date(overview.standing.lastAttemptAt))}`;

/** Which sitting of the paper this was, and the day it was sat — in the institute's own zone. */
function sittingHint(point: PerformancePoint): string {
  const on = point.submittedAt === null ? null : WHEN.format(new Date(point.submittedAt));
  return [`Attempt ${point.attemptNo}`, on].filter((part) => part !== null).join(' · ');
}
