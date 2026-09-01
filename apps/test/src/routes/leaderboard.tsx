import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ClipboardList, Layers, Trophy } from 'lucide-react';
import {
  Alert,
  Button,
  Combobox,
  EmptyState,
  LoadingState,
  PageHeader,
  PanelFrame,
  SectionHeading,
  plural,
  type ListFilter,
} from '@iace/ui';
import { PageCrumbs, useFilters, useFilterSpec } from '@iace/app-kit/browser';
import {
  EVALUATION_MODE,
  LEADERBOARD_SCOPES,
  leaderboardScopeSchema,
  testsSat,
  type Leaderboard,
  type LeaderboardQueryInput,
  type LeaderboardScope,
  type SatSeries,
  type SatTest,
} from '@iace/contracts';
import { api } from '../lib/api';
import {
  LEADERBOARD_SCOPE_LABELS,
  NAV_ITEMS,
  PERFORMANCE_QUERY_KEY,
  PERFORMANCE_SERIES_QUERY_KEY,
  ROUTES,
  leaderboardQueryKey,
} from '../lib/constants';
import { Podium, Standings } from '../components/leaderboard/board';

// TEST is the empty row, not a labelled one, so an unset URL shows the board it actually defaults to.
const SCOPE_ITEMS = [
  { value: '', label: LEADERBOARD_SCOPE_LABELS[LEADERBOARD_SCOPES.TEST] },
  ...Object.entries(LEADERBOARD_SCOPE_LABELS)
    .filter(([value]) => value !== LEADERBOARD_SCOPES.TEST)
    .map(([value, label]) => ({ value, label })),
];

const UNTITLED = 'Untitled test';

function scopeIdFor(scope: LeaderboardScope, testId: string, seriesId: string): string {
  if (scope === LEADERBOARD_SCOPES.TEST) return testId;
  if (scope === LEADERBOARD_SCOPES.SERIES) return seriesId;
  return '';
}

function queryFor(scope: LeaderboardScope, scopeId: string): LeaderboardQueryInput {
  if (scope === LEADERBOARD_SCOPES.TEST) return { scope, testId: scopeId };
  if (scope === LEADERBOARD_SCOPES.SERIES) return { scope, seriesId: scopeId };
  return { scope: LEADERBOARD_SCOPES.ALL_TIME };
}

export function LeaderboardPage() {
  const trend = useQuery({ queryKey: PERFORMANCE_QUERY_KEY, queryFn: () => api.me.performance() });
  const sat = testsSat(trend.data?.points ?? []);

  // A cascade the spec can't model: `scope` decides the second control, so it's read raw first.
  const scopeParam = useFilters<'scope'>();
  const parsedScope = leaderboardScopeSchema.safeParse(scopeParam.get('scope'));
  const scope = parsedScope.success ? parsedScope.data : LEADERBOARD_SCOPES.TEST;
  const onSeries = scope === LEADERBOARD_SCOPES.SERIES;

  const series = useQuery({
    queryKey: PERFORMANCE_SERIES_QUERY_KEY,
    queryFn: () => api.me.performanceSeries(),
    enabled: onSeries,
  });
  const seriesRows = series.data ?? [];

  // The empty row falls back to sat[0] (testsSat sorts most-recent-first), so it wears that title.
  const TEST_FILTER = {
    key: 'testId',
    kind: 'choice',
    label: 'Test',
    primary: true,
    items: [
      { value: '', label: sat[0]?.title ?? UNTITLED },
      ...sat.map((test) => ({ value: test.testId, label: test.title ?? UNTITLED })),
    ],
  } as const;

  // Same for seriesRows[0] (satSeries sorts by name) — "First series" is its own literal fallback.
  const SERIES_FILTER = {
    key: 'seriesId',
    kind: 'choice',
    label: 'Series',
    primary: true,
    items: [
      { value: '', label: seriesRows[0]?.name ?? 'First series' },
      ...seriesRows.map((row) => ({ value: row.id, label: row.name })),
    ],
  } as const;

  let FILTERS;
  if (scope === LEADERBOARD_SCOPES.SERIES) {
    FILTERS = [SERIES_FILTER] as const satisfies readonly ListFilter[];
  } else if (scope === LEADERBOARD_SCOPES.TEST) {
    FILTERS = [TEST_FILTER] as const satisfies readonly ListFilter[];
  } else {
    FILTERS = [] as const satisfies readonly ListFilter[];
  }

  const filters = useFilterSpec(FILTERS);
  const testId = filters.values.testId || (sat[0]?.testId ?? '');
  const seriesId = filters.values.seriesId || (seriesRows[0]?.id ?? '');

  const scopeId = scopeIdFor(scope, testId, seriesId);
  const board = useQuery({
    queryKey: leaderboardQueryKey(scope, scopeId),
    queryFn: () => api.me.leaderboard(queryFor(scope, scopeId)),
    enabled: scope === LEADERBOARD_SCOPES.ALL_TIME || scopeId !== '',
  });

  const boardControl = (
    <div className="w-44">
      <Combobox
        aria-label="Board"
        clearable={false}
        value={scope === LEADERBOARD_SCOPES.TEST ? '' : scope}
        onChange={(next) => scopeParam.set({ scope: next || undefined })}
        items={SCOPE_ITEMS}
      />
    </div>
  );

  return (
    <PanelFrame
      header={
        <PageHeader
          breadcrumbs={<PageCrumbs nav={NAV_ITEMS} />}
          title="Leaderboard"
          meta={standingMeta(board.data)}
        />
      }
      filters={
        sat.length > 0 ? { spec: FILTERS, state: filters, leading: boardControl } : undefined
      }
    >
      <Body trend={trend} series={series} board={board} tests={sat} onSeries={onSeries} />
    </PanelFrame>
  );
}

interface QueryState {
  isLoading: boolean;
  isError: boolean;
}

/** Loading, failed and empty are three facts. A failed read must never read as "nobody is here". */
function Body({
  trend,
  series,
  board,
  tests,
  onSeries,
}: Readonly<{
  trend: QueryState;
  series: QueryState & { data?: SatSeries[] };
  board: QueryState & { data?: Leaderboard };
  tests: readonly SatTest[];
  onSeries: boolean;
}>) {
  if (trend.isLoading) return <LoadingState />;
  if (trend.isError) return <Alert variant="danger">Your tests did not load.</Alert>;
  if (tests.length === 0) {
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

  if (board.isError) return <Alert variant="danger">This leaderboard did not load.</Alert>;
  if (!board.data) return <LoadingState />;

  return <Board board={board.data} />;
}

function Board({ board }: Readonly<{ board: Leaderboard }>) {
  if (board.evaluationMode === EVALUATION_MODE.PRACTICE) {
    return (
      <EmptyState
        icon={Trophy}
        title="Not ranked"
        // ui-copy-ok: rule
        hint="A practice paper is never placed against a cohort."
        action={
          <Button asChild>
            <Link to={ROUTES.PERFORMANCE}>Go to your performance</Link>
          </Button>
        }
      />
    );
  }
  if (board.cohortSize === 0) {
    return <EmptyState icon={Trophy} title="No standings yet" />;
  }

  return (
    <div className="flex flex-col gap-6 pb-8">
      <Alert variant="info">
        Only a first sitting is ranked. A retake and a practice paper are marked, but they are not
        on this board.
      </Alert>

      <div className="flex flex-col gap-3">
        <SectionHeading title="Podium" />
        <Podium rows={board.podium} />
      </div>

      <div className="flex min-h-0 flex-col gap-3">
        <SectionHeading title="Standings" />
        <Standings board={board} empty="Everyone on this board is on the podium." />
      </div>
    </div>
  );
}

const ORDINAL_SUFFIX = ['th', 'st', 'nd', 'rd'] as const;

/** 1st, 22nd, 113th — the teens are the exception every naive rule gets wrong. */
function ordinal(rank: number): string {
  const tens = rank % 100;
  const units = rank % 10;
  const suffix = tens >= 11 && tens <= 13 ? ORDINAL_SUFFIX[0] : (ORDINAL_SUFFIX[units] ?? 'th');
  return `${rank}${suffix}`;
}

/** The reader's own seat is the headline; the cohort alone is what a board without them shows. */
function standingMeta(board?: Leaderboard): string | undefined {
  if (!board) return undefined;
  if (board.you === null) return plural(board.cohortSize, 'student');
  return `${ordinal(board.you.rank)} of ${board.cohortSize}`;
}
