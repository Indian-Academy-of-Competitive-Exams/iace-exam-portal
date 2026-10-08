import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  EMPTY_STATE_KINDS,
  Alert,
  Button,
  EmptyState,
  PageHeader,
  PanelFrame,
  plural,
  type ListFilter,
} from '@iace/ui';
import { everySitting, ordinal } from '@iace/app-kit';
import { PageCrumbs, useFilterSpec, usePageTour } from '@iace/app-kit/browser';
import { testsSat, type Leaderboard, type SatTest } from '@iace/contracts';
import { api } from '../../lib/api';
import { performanceQuery } from '../../lib/queries';
import { NAV_ITEMS, ROUTES, leaderboardQueryKey } from '../../lib/constants';
import { Podium, Standings } from './board';
import { LEADERBOARD_TOUR, TOUR_IDS, TOUR_TARGETS } from '../../lib/tours';
import { RowsSkeleton, Section } from '../../components/ui';

const UNTITLED = 'Untitled test';

export function LeaderboardPage() {
  const trend = useQuery(performanceQuery);

  const sat = testsSat(everySitting(trend.data));

  // The empty row IS sat[0] (testsSat sorts most-recent-first), so sat[0] is not listed again.
  const TEST_FILTER = {
    key: 'testId',
    kind: 'choice',
    label: 'Test',
    primary: true,
    items: [
      { value: '', label: sat[0]?.title ?? UNTITLED },
      ...sat.slice(1).map((test) => ({ value: test.testId, label: test.title ?? UNTITLED })),
    ],
  } as const;

  // Nothing ranked leaves the bar empty rather than offering a picker with one dead row in it.
  const FILTERS =
    sat.length > 0
      ? ([TEST_FILTER] as const satisfies readonly ListFilter[])
      : ([] as const satisfies readonly ListFilter[]);

  const filters = useFilterSpec(FILTERS);
  const testId = filters.values.testId || (sat[0]?.testId ?? '');

  const board = useQuery({
    queryKey: leaderboardQueryKey(testId),
    queryFn: () => api.me.leaderboard({ testId }),
    enabled: testId !== '',
  });

  // The podium and the ranks live inside the board's own query, so `trend` landing is too early to point at them.
  usePageTour({ id: TOUR_IDS.LEADERBOARD, steps: LEADERBOARD_TOUR, ready: board.isSuccess });

  return (
    <PanelFrame
      header={
        <PageHeader
          breadcrumbs={<PageCrumbs nav={NAV_ITEMS} />}
          title="Leaderboard"
          meta={standingMeta(board.data)}
        />
      }
      filters={{ spec: FILTERS, state: filters }}
      filtersBesideTitle
    >
      <Body trend={trend} board={board} tests={sat} />
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
  board,
  tests,
}: Readonly<{
  trend: QueryState;
  board: QueryState & { data?: Leaderboard };
  tests: readonly SatTest[];
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
        title="No test sat yet"
        action={
          <Button asChild>
            <Link to={ROUTES.TESTS}>Go to your tests</Link>
          </Button>
        }
      />
    );
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
  if (board.cohortSize === 0) {
    return <EmptyState title="No ranks yet" />;
  }

  return (
    <div className="flex flex-col gap-6 pb-8">
      <Alert variant="info">
        Only a first sitting is ranked. A retake is marked, but it is not on this board.
      </Alert>

      <Section tour={TOUR_TARGETS.LEADERBOARD_PODIUM} title="Podium">
        <Podium rows={board.podium} />
      </Section>

      <Section
        tour={TOUR_TARGETS.LEADERBOARD_RANKS}
        title="Ranks"
        meta={plural(board.cohortSize, 'student')}
      >
        <Standings board={board} empty="Everyone on this board is on the podium" />
      </Section>
    </div>
  );
}

/** The reader's own seat is the headline; the cohort alone is what a board without them shows. */
function standingMeta(board?: Leaderboard): string | undefined {
  if (!board) return undefined;
  if (board.you === null) return plural(board.cohortSize, 'student');
  return `${ordinal(board.you.rank)} of ${board.cohortSize}`;
}
