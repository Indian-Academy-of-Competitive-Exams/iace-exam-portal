import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { BookOpenCheck } from 'lucide-react';
import {
  Alert,
  Badge,
  Button,
  DataTable,
  LoadingState,
  PageFrame,
  PageHeader,
  Progress,
  StatRow,
  TruncatedText,
  plural,
  type DataTableColumn,
} from '@iace/ui';
import { PageCrumbs } from '@iace/app-kit/browser';
import { type ScoreCard, type ScoreCardSection } from '@iace/contracts';
import { api } from '../lib/api';
import { NAV_ITEMS, ROUTES, scoreCardQueryKey } from '../lib/constants';

const SECTION_COLUMNS: readonly DataTableColumn<ScoreCardSection>[] = [
  {
    key: 'name',
    header: 'Section',
    className: 'max-w-[16rem]',
    cell: (row) => <TruncatedText>{row.name}</TruncatedText>,
  },
  { key: 'marks', header: 'Marks', cell: (row) => `${row.score} / ${row.maxMarks}` },
  { key: 'correct', header: 'Correct', numeric: true, cell: (row) => row.correctCount },
  { key: 'wrong', header: 'Wrong', numeric: true, cell: (row) => row.wrongCount },
  { key: 'left', header: 'Unattempted', numeric: true, cell: (row) => row.unattemptedCount },
  { key: 'time', header: 'Time', cell: (row) => minutes(row.timeSpentSec) },
];

export function ScoreCardPage() {
  const { attemptId = '' } = useParams();
  const card = useQuery({
    queryKey: scoreCardQueryKey(attemptId),
    queryFn: () => api.me.scoreCard(attemptId),
  });

  return (
    <PageFrame
      header={
        <PageHeader
          breadcrumbs={
            <PageCrumbs nav={NAV_ITEMS} tail={[{ label: card.data?.testTitle ?? 'Score card' }]} />
          }
          title="Score card"
          meta={card.data ? `${card.data.score} of ${card.data.maxMarks} marks` : undefined}
          action={
            <Button asChild variant="outline">
              <Link to={ROUTES.REVIEW(attemptId)}>
                <BookOpenCheck aria-hidden />
                Review the paper
              </Link>
            </Button>
          }
        />
      }
    >
      {card.isLoading ? <LoadingState /> : null}
      {card.data ? <Result card={card.data} /> : null}
    </PageFrame>
  );
}

function Result({ card }: Readonly<{ card: ScoreCard }>) {
  const attempted = card.correctCount + card.wrongCount;
  const accuracy = attempted === 0 ? 0 : Math.round((card.correctCount / attempted) * 100);

  return (
    <div className="flex flex-col gap-6">
      {card.provisional ? (
        /* ui-copy-ok: consequence */
        <Alert variant="info">
          This standing can still move: others can still sit this test. It settles once the test has
          closed for everyone.
        </Alert>
      ) : null}

      {card.isGraded ? null : (
        /* ui-copy-ok: consequence */
        <Alert variant="info">
          This was a retake, so it is marked but it does not carry a rank.
        </Alert>
      )}

      <div className="grid gap-x-8 gap-y-2 sm:grid-cols-2">
        <StatRow label="Marks" value={`${card.score} / ${card.maxMarks}`} />
        <StatRow label="Percentage" value={`${card.percentage}%`} />
        <StatRow
          label="Rank"
          value={
            <span className="flex items-center gap-2">
              {card.rank === null ? '—' : rankOf(card.rank, card.cohortSize)}
              {card.provisional && card.rank !== null ? (
                <Badge variant="neutral">Provisional</Badge>
              ) : null}
            </span>
          }
        />
        <StatRow label="Percentile" value={card.percentile === null ? '—' : `${card.percentile}`} />
        <StatRow label="Correct" value={card.correctCount} />
        <StatRow label="Wrong" value={card.wrongCount} />
        <StatRow label="Unattempted" value={card.unattemptedCount} />
        <StatRow
          label="Time taken"
          value={`${minutes(card.timeTakenSec)} of ${minutes(card.durationSec)}`}
        />
      </div>

      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-foreground">Accuracy</h2>
        <Progress value={accuracy} aria-label="Accuracy" />
        <StatRow
          label={`${card.correctCount} right of ${plural(attempted, 'attempt')}`}
          value={`${accuracy}%`}
        />
      </div>

      <div className="flex min-h-0 flex-col gap-2">
        <h2 className="text-sm font-semibold text-foreground">Sections</h2>
        <DataTable
          columns={SECTION_COLUMNS}
          rows={card.sections}
          rowKey={(row) => row.baseConfigSectionId}
          isLoading={false}
          empty="This paper had no sections."
        />
      </div>
    </div>
  );
}

const rankOf = (rank: number, cohortSize: number | null) =>
  cohortSize === null ? `${rank}` : `${rank} of ${cohortSize}`;

/** Seconds read as minutes on a result screen; nobody counts a paper in seconds. */
function minutes(seconds: number): string {
  const whole = Math.floor(seconds / 60);
  return whole === 0 ? `${seconds}s` : `${whole}m`;
}
