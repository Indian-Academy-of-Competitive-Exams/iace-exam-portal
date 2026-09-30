/// <reference types="nativewind/types" />
import { useState } from 'react';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { everySitting } from '@iace/app-kit';
import { testsSat } from '@iace/contracts';
import { Text } from '../ui/text';
import { api } from '../../lib/api';
import { leaderboardQueryKey } from '../../lib/constants';
import { performanceQuery } from '../../lib/queries';
import { plural } from '../../lib/plural';
import { Alert } from '../ui/alert';
import { ChipRow } from '../ui/chip-row';
import { EmptyState, EMPTY_STATE_KINDS } from '../ui/empty-state';
import { RefreshScroll } from '../ui/refresh-scroll';
import { Skeleton } from '../ui/skeleton';
import { Podium, Standings } from './board';

const UNTITLED = 'Untitled test';

export function LeaderboardPanel() {
  const trend = useQuery(performanceQuery);
  const [testId, setTestId] = useState('');

  const sat = testsSat(everySitting(trend.data));
  const paper = testId || (sat[0]?.testId ?? '');

  const board = useQuery({
    queryKey: leaderboardQueryKey(paper),
    queryFn: () => api.me.leaderboard({ testId: paper }),
    enabled: paper !== '',
  });

  return (
    <RefreshScroll refreshing={board.isRefetching} onRefresh={() => void board.refetch()}>
      {sat.length > 0 ? (
        <ChipRow
          scroll
          label="Test"
          options={sat.map((test) => ({ value: test.testId, label: test.title ?? UNTITLED }))}
          value={paper}
          onChange={setTestId}
        />
      ) : null}

      {paper === '' ? <NotAskedYet trend={trend} /> : null}
      {paper !== '' && board.isLoading ? <Skeleton className="h-64 rounded-xl" /> : null}
      {paper !== '' && board.isError ? (
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
