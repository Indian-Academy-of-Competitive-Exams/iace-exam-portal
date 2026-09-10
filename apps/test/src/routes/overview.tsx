import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  EMPTY_STATE_KINDS,
  Alert,
  Button,
  Combobox,
  EmptyState,
  PageFrame,
  PageHeader,
  SegmentedControl,
  plural,
} from '@iace/ui';
import {
  BlindSpots,
  DispositionFigure,
  ModeGapFigure,
  ModeTiles,
  PageCrumbs,
  ScopeGapFigure,
  ScoreTrendFigure,
  SpeedAccuracyFigure,
  SubjectStrengthFigure,
  TimeReturnFigure,
  WeakestSubjectsFigure,
} from '@iace/app-kit/browser';
import { newestFirst } from '@iace/app-kit';
import {
  EVALUATION_MODE,
  EVALUATION_MODE_LABELS,
  EVALUATION_MODES,
  INSTITUTE_TIME_ZONE,
  TEST_SCOPE_LABELS,
  civilDate,
  todayISO,
  bestSitting,
  effortPerSitting,
  scopesSat,
  volumeByScope,
  standingTiles,
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
import {
  BlockPairSkeleton,
  Hero,
  HeroFigure,
  PageBody,
  StatTile,
  TileGrid,
  TilesSkeleton,
} from '../components/ui';

const UNTITLED = 'Untitled test';
const DASH = '—';

const WHEN = new Intl.DateTimeFormat('en-IN', {
  timeZone: INSTITUTE_TIME_ZONE,
  dateStyle: 'medium',
});

const MODE_ITEMS = EVALUATION_MODES.map((mode) => ({
  value: mode,
  label: EVALUATION_MODE_LABELS[mode],
}));

/** Three bands wide, not eight blocks tall: the standing, its counts, then the figures in one row. */
export function OverviewPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<EvaluationMode>(EVALUATION_MODE.RANKED);
  const [scope, setScope] = useState<TestScope | null>(null);
  const overview = useQuery({ queryKey: OVERVIEW_QUERY_KEY, queryFn: () => api.me.overview() });
  const trend = useQuery({ queryKey: PERFORMANCE_QUERY_KEY, queryFn: () => api.me.performance() });

  const sat = newestFirst(trend.data?.points ?? []);
  const scopes = overview.data ? scopesSat(overview.data.subjects, mode) : [];
  const chosen = scope !== null && scopes.includes(scope) ? scope : null;
  const volume = new Map(
    (overview.data ? volumeByScope(overview.data.subjects, mode) : []).map((row) => [
      row.scope,
      row.attempted,
    ]),
  );

  return (
    <PageFrame
      header={
        <PageHeader
          breadcrumbs={<PageCrumbs nav={NAV_ITEMS} />}
          size="display"
          title="Performance"
          meta={overview.data ? satOn(overview.data) : undefined}
          action={
            <span className="flex flex-wrap items-center gap-3">
              <SegmentedControl
                value={mode}
                onChange={(next) => setMode(next as EvaluationMode)}
                items={MODE_ITEMS}
                aria-label="Evaluation mode"
              />
              {scopes.length > 1 ? (
                <Combobox
                  aria-label="Scope"
                  clearable={false}
                  value={chosen ?? ANY_SCOPE}
                  onChange={(next) => setScope(next === ANY_SCOPE ? null : (next as TestScope))}
                  items={[
                    { value: ANY_SCOPE, label: 'Every scope' },
                    ...scopes.map((value) => ({
                      value,
                      label: TEST_SCOPE_LABELS[value],
                      hint: plural(volume.get(value) ?? 0, 'question'),
                    })),
                  ]}
                  className={PICKER_WIDTH.SCOPE}
                />
              ) : null}
              {sat.length > 0 ? (
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
              ) : null}
            </span>
          }
        />
      }
    >
      <PageBody>
        {overview.isLoading ? (
          <>
            <TilesSkeleton count={3} />
            <BlockPairSkeleton />
          </>
        ) : null}
        {overview.isError ? (
          <EmptyState
            kind={EMPTY_STATE_KINDS.FAILURE}
            title="Your performance did not load"
            onRetry={overview.refetch}
          />
        ) : null}
        {overview.data ? (
          <Body
            overview={overview.data}
            mode={mode}
            scope={chosen}
            sittings={(trend.data?.points ?? []).filter((point) => point.evaluationMode === mode)}
          />
        ) : null}
      </PageBody>
    </PageFrame>
  );
}

function Body({
  overview,
  mode,
  scope,
  sittings,
}: Readonly<{
  overview: StudentOverview;
  mode: EvaluationMode;
  scope: TestScope | null;
  sittings: readonly PerformancePoint[];
}>) {
  if (overview.standing.testsAttempted === 0) {
    return (
      <EmptyState
        title="No tests sat yet"
        action={
          <Button asChild>
            <Link to={ROUTES.TESTS}>Go to your tests</Link>
          </Button>
        }
      />
    );
  }

  const view = { subjects: overview.subjects, mode, scope };
  const headline = headlineOf(overview, mode, sittings);
  const measured = overview.byMode[mode].attempted > 0;
  const pace = <ModeTiles measure={overview.byMode[mode]} />;

  return (
    <>
      {/* With no headline the pace tiles lead, or the band would sit empty down its whole left. */}
      {headline !== null || measured ? (
        <Hero tone="accent" figure={headline ?? pace} aside={headline ? pace : undefined} />
      ) : null}

      {mode === EVALUATION_MODE.RANKED && overview.standing.testsEvaluated === 0 ? (
        /* ui-copy-ok: consequence */
        <Alert variant="info">
          No ranked test of yours has been marked yet, so there is no percentile or score to stand
          on. Switch to Practice for what your practice has counted.
        </Alert>
      ) : null}

      <TileGrid className="sm:grid-cols-3 lg:grid-cols-3 xl:grid-cols-3">
        {standingTiles(overview.standing, overview.byMode[mode], mode).map((tile) => (
          <StatTile key={tile.key} label={tile.label} value={tile.value ?? DASH} foot={tile.foot} />
        ))}
      </TileGrid>

      <BlindSpots subjects={overview.subjects} mode={mode} scope={scope} />

      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-4">
        <WeakestSubjectsFigure {...view} className="lg:col-span-2" />
        <ScoreTrendFigure points={sittings} className="lg:col-span-2" />
        <DispositionFigure
          disposition={overview.disposition}
          effort={effortPerSitting(overview.standing, overview.disposition)}
        />
        <SubjectStrengthFigure {...view} />
        <TimeReturnFigure {...view} className="lg:col-span-2" />
        <ModeGapFigure subjects={overview.subjects} scope={scope} className="lg:col-span-2" />
        <ScopeGapFigure
          subjects={overview.subjects}
          mode={mode}
          className="lg:col-span-2 xl:col-span-4"
        />
      </div>

      {/* Full width: its dot labels collide with the quadrant corners in anything narrower. */}
      <SpeedAccuracyFigure {...view} />
    </>
  );
}

/** Percentile is a RANKED standing; practice has no placing, so its best sitting is the target. */
function headlineOf(
  overview: StudentOverview,
  mode: EvaluationMode,
  sittings: readonly PerformancePoint[],
) {
  if (mode === EVALUATION_MODE.PRACTICE) {
    const best = bestSitting(sittings);
    if (best === null) return null;
    return (
      <HeroFigure
        value={Math.round(best.percentage)}
        unit="%"
        caption={`best of ${plural(sittings.length, 'practice sitting')} · ${best.score} of ${best.maxMarks}`}
      />
    );
  }

  if (overview.standing.testsEvaluated === 0) return null;
  return (
    <HeroFigure
      value={overview.standing.avgPercentile ?? DASH}
      unit={overview.standing.avgPercentile === null ? undefined : 'th'}
      caption={bestLine(overview)}
    />
  );
}

function satOn(overview: StudentOverview): string | undefined {
  const at = overview.standing.lastAttemptAt;
  if (at === null) return undefined;
  const days = daysSince(at);
  const ago = days === 0 ? 'today' : plural(days, 'day') + ' ago';
  return `Last sat ${WHEN.format(new Date(at))} · ${ago}`;
}

/** Whole institute days between two civil dates — never a UTC subtraction on a stored instant. */
function daysSince(at: string): number {
  const then = Date.parse(`${civilDate(new Date(at))}T00:00:00Z`);
  const today = Date.parse(`${todayISO()}T00:00:00Z`);
  return Math.max(0, Math.round((today - then) / 86_400_000));
}

/** The average alone is half the story; the best is what a student is actually chasing. */
function bestLine(overview: StudentOverview): string {
  const { avgPercentile, bestPercentile } = overview.standing;
  if (bestPercentile === null) return 'average percentile';
  const spread =
    avgPercentile === null ? '' : ` · ${Math.round(bestPercentile - avgPercentile)} above it`;
  return `average percentile · best ${bestPercentile}${spread}`;
}

/** Which sitting of the paper this was, and the day it was sat — in the institute's own zone. */
function sittingHint(point: PerformancePoint): string {
  const on = point.submittedAt === null ? null : WHEN.format(new Date(point.submittedAt));
  return [`Attempt ${point.attemptNo}`, on].filter((part) => part !== null).join(' · ');
}
