import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Alert, ComparisonCards, plural, type ComparisonItem } from '@iace/ui';
import { percentLabel, type CohortCurve } from '@iace/contracts';
import { everySitting } from '@iace/app-kit';
import { api } from '../../lib/api';
import { performanceQuery, scoreCardQuery } from '../../lib/queries';
import { leaderboardQueryKey } from '../../lib/constants';
import { PageBody, RowsSkeleton, Section } from '../../components/ui';
import { AttemptCompare } from './attempt-compare';
import { ScoreCardGate } from './score-card-gate';
import { Podium, Standings } from '../leaderboard/board';

/** Who else sat this paper. Without a cohort the benchmark swaps rather than the tab disappearing. */
export function ComparePanel() {
  const { attemptId = '' } = useParams();
  const card = useQuery(scoreCardQuery(attemptId));
  const trend = useQuery(performanceQuery);

  const testId = card.data?.testId ?? '';
  const placed = (card.data?.cohort?.cohortSize ?? 0) > 0;
  const [page, setPage] = useState(1);
  const board = useQuery({
    queryKey: [...leaderboardQueryKey(testId), page],
    queryFn: () => api.me.leaderboard({ testId, page }),
    enabled: placed && testId !== '',
    placeholderData: keepPreviousData,
  });

  return (
    <ScoreCardGate card={card} failed="This comparison did not load">
      {(data) => {
        const sittings = everySitting(trend.data).filter((point) => point.testId === testId);

        return (
          <PageBody>
            {placed ? (
              <Against cohort={data.cohort} maxMarks={data.maxMarks} />
            ) : (
              <AttemptCompare attemptId={attemptId} sittings={sittings} cohort={data.cohort} />
            )}

            <Standing placed={placed} />

            {placed ? (
              <Section title="Leaderboard">
                {board.isLoading ? <RowsSkeleton rows={5} /> : null}
                {board.data ? (
                  <>
                    <Podium rows={board.data.podium} />
                    <Standings
                      board={board.data}
                      empty="Nobody has been ranked on this paper yet"
                      onPage={setPage}
                    />
                  </>
                ) : null}
              </Section>
            ) : null}
          </PageBody>
        );
      }}
    </ScoreCardGate>
  );
}

/** A paper nobody has been ranked on yet stands against the student's own attempts. */
function Standing({ placed }: Readonly<{ placed: boolean }>) {
  if (placed) return null;

  return (
    /* ui-copy-ok: consequence */
    <Alert variant="info">
      Nobody has been ranked on this paper yet, so it stands against your own attempts for now.
    </Alert>
  );
}

/** You, the field's average and the paper's topper on one scale of marks. */
function Against({
  cohort,
  maxMarks: max,
}: Readonly<{ cohort: CohortCurve | null; maxMarks: number }>) {
  if (cohort === null) return null;

  const items: ComparisonItem[] = [
    {
      key: 'you',
      label: 'You',
      value: cohort.score,
      max,
      display: String(cohort.score),
      segments: [{ key: 'you', label: 'Marks', value: cohort.score, tone: 'positive' }],
      caption: percentLabel(cohort.percentile, '—'),
      tone: 'current',
    },
    {
      key: 'average',
      label: 'Average',
      value: cohort.averageScore ?? 0,
      max,
      display: String(cohort.averageScore ?? '—'),
      segments: [
        { key: 'average', label: 'Marks', value: cohort.averageScore ?? 0, tone: 'neutral' },
      ],
      caption: plural(cohort.cohortSize, 'sitting'),
    },
    {
      key: 'topper',
      label: 'Topper',
      value: cohort.topperScore ?? 0,
      max,
      display: String(cohort.topperScore ?? '—'),
      segments: [
        { key: 'topper', label: 'Marks', value: cohort.topperScore ?? 0, tone: 'positive' },
      ],
      caption: `of ${max} marks`,
      tone: 'good',
    },
  ];

  return <ComparisonCards items={items} />;
}
