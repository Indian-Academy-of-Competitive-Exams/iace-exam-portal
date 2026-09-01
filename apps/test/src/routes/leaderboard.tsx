import * as React from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ClipboardList, Layers, Trophy } from 'lucide-react';
import {
  Alert,
  Button,
  Combobox,
  EmptyState,
  LoadingState,
  PageFrame,
  PageHeader,
  SectionHeading,
  plural,
} from '@iace/ui';
import {
  EVALUATION_MODE,
  LEADERBOARD_SCOPES,
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
  PERFORMANCE_QUERY_KEY,
  PERFORMANCE_SERIES_QUERY_KEY,
  PICKER_WIDTH,
  ROUTES,
  leaderboardQueryKey,
} from '../lib/constants';
import { Podium, Standings } from '../components/leaderboard/board';

const SCOPE_ITEMS = Object.entries(LEADERBOARD_SCOPE_LABELS).map(([value, label]) => ({
  value,
  label,
}));

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
  const [scope, setScope] = React.useState<LeaderboardScope>(LEADERBOARD_SCOPES.TEST);
  const [picked, setPicked] = React.useState('');
  const [pickedSeries, setPickedSeries] = React.useState('');

  const trend = useQuery({ queryKey: PERFORMANCE_QUERY_KEY, queryFn: () => api.me.performance() });
  const sat = testsSat(trend.data?.points ?? []);
  const testId = sat.some((test) => test.testId === picked) ? picked : (sat[0]?.testId ?? '');

  const onSeries = scope === LEADERBOARD_SCOPES.SERIES;
  const series = useQuery({
    queryKey: PERFORMANCE_SERIES_QUERY_KEY,
    queryFn: () => api.me.performanceSeries(),
    enabled: onSeries,
  });
  const seriesRows = series.data ?? [];
  const seriesId = seriesRows.some((row) => row.id === pickedSeries)
    ? pickedSeries
    : (seriesRows[0]?.id ?? '');

  const scopeId = scopeIdFor(scope, testId, seriesId);
  const board = useQuery({
    queryKey: leaderboardQueryKey(scope, scopeId),
    queryFn: () => api.me.leaderboard(queryFor(scope, scopeId)),
    enabled: scope === LEADERBOARD_SCOPES.ALL_TIME || scopeId !== '',
  });

  return (
    <PageFrame
      header={
        <PageHeader
          title="Leaderboard"
          meta={standingMeta(board.data)}
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
      <Body trend={trend} series={series} board={board} tests={sat} onSeries={onSeries} />
    </PageFrame>
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

/** What the board is OF, chosen in the header: which paper or series, and how wide to read. */
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
  scope: LeaderboardScope;
  onPickScope: (scope: LeaderboardScope) => void;
}>) {
  if (tests.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {scope === LEADERBOARD_SCOPES.TEST ? (
        <Combobox
          className={PICKER_WIDTH.RECORD}
          items={tests.map((test) => ({ value: test.testId, label: test.title ?? UNTITLED }))}
          value={testId}
          onChange={onPickTest}
          clearable={false}
          aria-label="Test"
        />
      ) : null}
      {scope === LEADERBOARD_SCOPES.SERIES && series.length > 0 ? (
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
        onChange={(next) => onPickScope(next as LeaderboardScope)}
        clearable={false}
        aria-label="Scope"
      />
    </div>
  );
}
