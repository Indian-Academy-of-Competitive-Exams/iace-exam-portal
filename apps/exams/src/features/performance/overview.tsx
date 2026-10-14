import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  EMPTY_STATE_KINDS,
  Button,
  Combobox,
  EmptyState,
  PageFrame,
  PageHeader,
  plural,
} from '@iace/ui';
import {
  DispositionFigure,
  MeasureTiles,
  PageCrumbs,
  usePageTour,
  ScopeGapFigure,
  ScoreTrendFigure,
  SpeedAccuracyFigure,
  SubjectStrengthFigure,
  TimeReturnFigure,
  WeakestSubjectsFigure,
} from '@iace/app-kit/browser';
import {
  everySitting,
  newestFirst,
  ordinalSuffix,
  sittingHint,
  bestLine,
  lastSatLine,
} from '@iace/app-kit';
import {
  TEST_SCOPE_LABELS,
  effortPerSitting,
  scopesSat,
  volumeByScope,
  standingTiles,
  type PerformancePoint,
  type StudentOverview,
  type TestScope,
} from '@iace/contracts';
import { overviewQuery, performanceQuery } from '../../lib/queries';
import { ANY_SCOPE, NAV_ITEMS, PICKER_WIDTH, ROUTES } from '../../lib/constants';
import { PERFORMANCE_TOUR, TOUR_IDS, TOUR_TARGETS } from '../../lib/tours';
import {
  BlockPairSkeleton,
  Hero,
  HeroFigure,
  PageBody,
  StatTile,
  TileGrid,
  TilesSkeleton,
} from '../../components/ui';

const UNTITLED = 'Untitled test';
const DASH = '—';

/** Three bands wide, not eight blocks tall: the standing, its counts, then the figures in one row. */
export function OverviewPage() {
  const navigate = useNavigate();
  const [scope, setScope] = useState<TestScope | null>(null);
  const overview = useQuery(overviewQuery);
  const trend = useQuery(performanceQuery);

  usePageTour({ id: TOUR_IDS.PERFORMANCE, steps: PERFORMANCE_TOUR, ready: overview.isSuccess });

  const sat = newestFirst(everySitting(trend.data));
  const scopes = overview.data ? scopesSat(overview.data.subjects) : [];
  const chosen = scope !== null && scopes.includes(scope) ? scope : null;
  const volume = new Map(
    (overview.data ? volumeByScope(overview.data.subjects) : []).map((row) => [
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
          meta={overview.data ? lastSatLine(overview.data) : undefined}
          action={
            <span
              data-tour={TOUR_TARGETS.PERFORMANCE_PICKERS}
              className="flex w-full flex-wrap items-center gap-3 sm:w-auto"
            >
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
          <Body overview={overview.data} scope={chosen} sittings={trend.data?.points ?? []} />
        ) : null}
      </PageBody>
    </PageFrame>
  );
}

function Body({
  overview,
  scope,
  sittings,
}: Readonly<{
  overview: StudentOverview;
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

  const view = { subjects: overview.subjects, scope };
  const headline = headlineOf(overview);
  const measured = overview.measure.attempted > 0;
  const pace = <MeasureTiles measure={overview.measure} />;

  return (
    <>
      {/* With no headline the pace tiles lead, or the band would sit empty down its whole left. */}
      {headline !== null || measured ? (
        <Hero
          tour={TOUR_TARGETS.PERFORMANCE_HERO}
          figure={headline ?? pace}
          aside={headline ? pace : undefined}
        />
      ) : null}

      <TileGrid className="sm:grid-cols-3 lg:grid-cols-3 xl:grid-cols-3">
        {standingTiles(overview.standing).map((tile) => (
          <StatTile key={tile.key} label={tile.label} value={tile.value ?? DASH} foot={tile.foot} />
        ))}
      </TileGrid>

      <div
        data-tour={TOUR_TARGETS.PERFORMANCE_FIGURES}
        className="grid items-start gap-4 lg:grid-cols-2 xl:grid-cols-4"
      >
        <WeakestSubjectsFigure {...view} className="lg:col-span-2" />
        <ScoreTrendFigure points={sittings} className="lg:col-span-2" />
        <DispositionFigure
          disposition={overview.disposition}
          effort={effortPerSitting(overview.standing, overview.disposition)}
        />
        <SubjectStrengthFigure {...view} />
        <TimeReturnFigure {...view} className="lg:col-span-2" />
        <ScopeGapFigure subjects={overview.subjects} className="lg:col-span-2 xl:col-span-4" />
      </div>

      {/* Full width: its dot labels collide with the quadrant corners in anything narrower. */}
      <SpeedAccuracyFigure {...view} />
    </>
  );
}

/** The standing is a percentile, so until a sitting is marked there is no headline. */
function headlineOf(overview: StudentOverview) {
  if (overview.standing.testsEvaluated === 0) return null;
  const { avgPercentile } = overview.standing;
  return (
    <HeroFigure
      value={avgPercentile ?? DASH}
      unit={avgPercentile === null ? undefined : ordinalSuffix(avgPercentile)}
      caption={bestLine(overview)}
    />
  );
}
