import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  EMPTY_STATE_KINDS,
  Alert,
  Button,
  Combobox,
  EmptyState,
  PageHeader,
  PanelFrame,
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
  type EvaluationMode,
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
import { RowsSkeleton, Section } from '../components/ui';

// TEST is the empty row, not a labelled one, so an unset URL shows the board it actually defaults to.
const SCOPE_ITEMS = [
  { value: '', label: LEADERBOARD_SCOPE_LABELS[LEADERBOARD_SCOPES.TEST] },
  ...Object.entries(LEADERBOARD_SCOPE_LABELS)
    .filter(([value]) => value !== LEADERBOARD_SCOPES.TEST)
    .map(([value, label]) => ({ value, label })),
];

const UNTITLED = 'Untitled test';

const isRanked = (row: Readonly<{ evaluationMode: EvaluationMode }>) =>
  row.evaluationMode === EVALUATION_MODE.RANKED;

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
  // A practice paper is never ranked, so offering one here promises a board that cannot exist.
  const sat = testsSat(trend.data?.points ?? []).filter(isRanked);

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
  const seriesRows = (series.data ?? []).filter(isRanked);

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

  // Nothing ranked to pick from leaves the board control alone in the bar, still reachable.
  let FILTERS;
  if (scope === LEADERBOARD_SCOPES.SERIES && seriesRows.length > 0) {
    FILTERS = [SERIES_FILTER] as const satisfies readonly ListFilter[];
  } else if (scope === LEADERBOARD_SCOPES.TEST && sat.length > 0) {
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
    // No ranked sitting means no board at ANY scope, all-time included — so nothing is asked for.
    enabled: sat.length > 0 && (scope === LEADERBOARD_SCOPES.ALL_TIME || scopeId !== ''),
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
      filters={{ spec: FILTERS, state: filters, leading: boardControl }}
      filtersBesideTitle
    >
      <Body
        trend={trend}
        series={{ ...series, length: seriesRows.length }}
        board={board}
        tests={sat}
        onSeries={onSeries}
      />
    </PanelFrame>
  );
}

interface QueryState {
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
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
  series: QueryState & { length: number };
  board: QueryState & { data?: Leaderboard };
  tests: readonly SatTest[];
  onSeries: boolean;
}>) {
  if (trend.isLoading) return <RowsSkeleton rows={6} />;
  if (trend.isError) {
    return (
      <EmptyState
        kind={EMPTY_STATE_KINDS.FAILURE}
        title="Your tests did not load"
        onRetry={trend.refetch}
      />
    );
  }
  if (tests.length === 0) {
    return (
      <EmptyState
        title="No ranked test sat yet"
        action={
          <Button asChild>
            <Link to={ROUTES.TESTS}>Go to your tests</Link>
          </Button>
        }
      />
    );
  }

  if (onSeries) {
    if (series.isError) {
      return (
        <EmptyState
          kind={EMPTY_STATE_KINDS.FAILURE}
          title="Your test series did not load"
          onRetry={series.refetch}
        />
      );
    }
    if (series.length === 0) return <EmptyState title="No ranked test series sat" />;
  }

  if (board.isError) {
    return (
      <EmptyState
        kind={EMPTY_STATE_KINDS.FAILURE}
        title="This leaderboard did not load"
        onRetry={board.refetch}
      />
    );
  }
  if (!board.data) return <RowsSkeleton rows={6} />;

  return <Board board={board.data} />;
}

function Board({ board }: Readonly<{ board: Leaderboard }>) {
  // Only a hand-typed URL reaches here now, but a practice paper still has no board to draw.
  if (board.evaluationMode === EVALUATION_MODE.PRACTICE) {
    return (
      <EmptyState
        title="Not ranked"
        // ui-copy-ok: rule
        hint="A practice paper is never ranked."
        action={
          <Button asChild>
            <Link to={ROUTES.PERFORMANCE}>Go to your performance</Link>
          </Button>
        }
      />
    );
  }
  if (board.cohortSize === 0) {
    return <EmptyState title="No ranks yet" />;
  }

  return (
    <div className="flex flex-col gap-6 pb-8">
      <Alert variant="info">
        Only a first sitting is ranked. A retake and a practice paper are marked, but they are not
        on this board.
      </Alert>

      <Section title="Podium">
        <Podium rows={board.podium} />
      </Section>

      <Section title="Ranks" meta={plural(board.cohortSize, 'student')}>
        <Standings board={board} empty="Everyone on this board is on the podium" />
      </Section>
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
