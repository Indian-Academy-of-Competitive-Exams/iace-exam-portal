/// <reference types="nativewind/types" />
import { useState } from 'react';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { boardQueryFor, isBoardAsked, LEADERBOARD_SCOPE_LABELS, scopeIdFor } from '@iace/app-kit';
import { LEADERBOARD_SCOPES, testsSat, type LeaderboardScope } from '@iace/contracts';
import { Text } from '../ui/text';
import { api } from '../../lib/api';
import { leaderboardQueryKey, PERFORMANCE_SERIES_QUERY_KEY } from '../../lib/constants';
import { performanceQuery } from '../../lib/queries';
import { plural } from '../../lib/plural';
import { Alert } from '../ui/alert';
import { ChipRow, type ChipOption } from '../ui/chip-row';
import { EmptyState, EMPTY_STATE_KINDS } from '../ui/empty-state';
import { RefreshScroll } from '../ui/refresh-scroll';
import { Skeleton } from '../ui/skeleton';
import { Podium, Standings } from './board';

const UNTITLED = 'Untitled test';

/** One paper, a series, or every paper they have sat — marks rank one, percentile the rest. */
const SCOPES: readonly ChipOption[] = Object.entries(LEADERBOARD_SCOPE_LABELS).map(
  ([value, label]) => ({ value, label }),
);

export function LeaderboardPanel() {
  const trend = useQuery(performanceQuery);
  const [scope, setScope] = useState<string>(LEADERBOARD_SCOPES.TEST);
  const [testId, setTestId] = useState('');
  const [seriesId, setSeriesId] = useState('');

  const sat = testsSat(trend.data?.points ?? []);
  const onSeries = scope === LEADERBOARD_SCOPES.SERIES;
  const series = useQuery({
    queryKey: PERFORMANCE_SERIES_QUERY_KEY,
    queryFn: () => api.me.performanceSeries(),
    enabled: onSeries,
  });

  const paper = testId || (sat[0]?.testId ?? '');
  const inSeries = seriesId || (series.data?.[0]?.id ?? '');
  const scopeId = scopeIdFor(scope as LeaderboardScope, paper, inSeries);
  const asked = isBoardAsked(scope as LeaderboardScope, scopeId, sat.length);

  const board = useQuery({
    queryKey: leaderboardQueryKey(scope as LeaderboardScope, scopeId),
    queryFn: () => api.me.leaderboard(boardQueryFor(scope as LeaderboardScope, scopeId)),
    enabled: asked,
  });

  return (
    <RefreshScroll refreshing={board.isRefetching} onRefresh={() => void board.refetch()}>
      <ChipRow scroll options={SCOPES} value={scope} onChange={setScope} />

      {scope === LEADERBOARD_SCOPES.TEST && sat.length > 0 ? (
        <ChipRow
          scroll
          label="Test"
          options={sat.map((test) => ({ value: test.testId, label: test.title ?? UNTITLED }))}
          value={paper}
          onChange={setTestId}
        />
      ) : null}

      {onSeries && (series.data?.length ?? 0) > 0 ? (
        <ChipRow
          scroll
          label="Series"
          options={(series.data ?? []).map((row) => ({ value: row.id, label: row.name }))}
          value={inSeries}
          onChange={setSeriesId}
        />
      ) : null}

      {asked ? null : <NotAskedYet trend={trend} />}
      {asked && board.isLoading ? <Skeleton className="h-64 rounded-xl" /> : null}
      {asked && board.isError ? (
        <EmptyState
          kind={EMPTY_STATE_KINDS.FAILURE}
          title="This board did not load"
          onRetry={() => void board.refetch()}
        />
      ) : null}

      {board.data ? (
        <>
          <Text variant="meta">{plural(board.data.cohortSize, 'student')}</Text>
          <Podium rows={board.data.podium} />
          <Standings board={board.data} empty="Nobody has been ranked here yet" />
          {board.data.you === null ? (
            <Alert variant="info">You are not on this board yet.</Alert>
          ) : null}
        </>
      ) : null}
    </RefreshScroll>
  );
}

/** No board is asked for until the tests it would list are known, and "none" only once they are. */
function NotAskedYet({ trend }: Readonly<{ trend: UseQueryResult<unknown> }>) {
  if (trend.isLoading) return <Skeleton className="h-64 rounded-xl" />;
  if (trend.isError) {
    return (
      <EmptyState
        kind={EMPTY_STATE_KINDS.FAILURE}
        title="Your tests did not load"
        onRetry={() => void trend.refetch()}
      />
    );
  }
  return <EmptyState title="No tests sat yet" />;
}
