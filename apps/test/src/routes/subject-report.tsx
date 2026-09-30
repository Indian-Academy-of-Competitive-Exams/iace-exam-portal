import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Badge,
  DataTable,
  EmptyState,
  EMPTY_STATE_KINDS,
  TruncatedText,
  plural,
  type DataTableColumn,
} from '@iace/ui';
import { SectionsFigure } from '@iace/app-kit/browser';
import { isMarkingPending, minutes } from '@iace/app-kit';
import { round2, type SectionalStanding } from '@iace/contracts';
import { scoreCardQuery } from '../lib/queries';
import { PageBody, ReportSkeleton, Section } from '../components/ui';

const DASH = '—';

/** Where a section stands against the field. A cutoff would be a line; this is a position. */
const STANDINGS = {
  ABOVE: { label: 'Above average', variant: 'success' },
  LEVEL: { label: 'At average', variant: 'neutral' },
  BELOW: { label: 'Below average', variant: 'warning' },
  NONE: { label: DASH, variant: 'neutral' },
} as const;

export function SubjectPanel() {
  const { attemptId = '' } = useParams();
  const card = useQuery(scoreCardQuery(attemptId));

  const again = () => void card.refetch();

  if (card.isLoading) return <ReportSkeleton />;
  // Reached before the queued job ran, which is ordinary now that nothing polls on the student's behalf.
  if (isMarkingPending(card.error)) {
    return (
      <EmptyState
        kind={EMPTY_STATE_KINDS.EMPTY}
        title="No marks yet"
        // ui-copy-ok: consequence
        hint="Your paper is handed in and safe."
        onRetry={again}
      />
    );
  }
  if (!card.data) {
    return (
      <EmptyState
        kind={EMPTY_STATE_KINDS.FAILURE}
        title="Your sections did not load"
        onRetry={again}
      />
    );
  }

  return <Body sections={card.data.sections} />;
}

function Body({ sections }: Readonly<{ sections: readonly SectionalStanding[] }>) {
  return (
    <PageBody>
      <Section title="Sections" meta={plural(sections.length, 'section')}>
        <DataTable
          columns={COLUMNS}
          rows={sections}
          rowKey={(row) => row.baseConfigSectionId}
          isLoading={false}
          empty="This paper had no sections"
        />
      </Section>

      <SectionsFigure sections={sections} />
    </PageBody>
  );
}

const COLUMNS: readonly DataTableColumn<SectionalStanding>[] = [
  {
    key: 'name',
    header: 'Section',
    className: 'max-w-[14rem]',
    cell: (row) => <TruncatedText>{row.name}</TruncatedText>,
  },
  { key: 'marks', header: 'Marks', numeric: true, cell: (row) => `${row.score} / ${row.maxMarks}` },
  { key: 'correct', header: 'Correct', numeric: true, cell: (row) => row.correctCount },
  { key: 'wrong', header: 'Wrong', numeric: true, cell: (row) => row.wrongCount },
  { key: 'left', header: 'Unattempted', numeric: true, cell: (row) => row.unattemptedCount },
  { key: 'yourTime', header: 'Your time', numeric: true, cell: (row) => minutes(row.timeSpentSec) },
  {
    key: 'cohortTime',
    header: 'Average time',
    numeric: true,
    cell: (row) => minutes(row.cohortAverageTimeSec),
  },
  {
    key: 'topperTime',
    header: 'Topper time',
    numeric: true,
    cell: (row) => minutes(row.topperTimeSec),
  },
  {
    key: 'rate',
    header: 'Marks a minute',
    numeric: true,
    cell: (row) => perMinute(row.score, row.timeSpentSec),
  },
  {
    key: 'cohortRate',
    header: 'Average a minute',
    numeric: true,
    cell: (row) => perMinute(row.cohortAverageScore, row.cohortAverageTimeSec),
  },
  {
    key: 'standing',
    header: 'Against average',
    cell: (row) => {
      const held = standingOf(row);
      return <Badge variant={held.variant}>{held.label}</Badge>;
    },
  },
];

function standingOf(row: SectionalStanding) {
  if (row.cohortAverageScore === null) return STANDINGS.NONE;
  if (row.score > row.cohortAverageScore) return STANDINGS.ABOVE;
  return row.score < row.cohortAverageScore ? STANDINGS.BELOW : STANDINGS.LEVEL;
}

/** What a minute in this section actually bought — the one figure that crosses marks with time. */
function perMinute(score: number | null, seconds: number | null): string {
  if (score === null || seconds === null || seconds === 0) return DASH;
  return round2(score / (seconds / 60)).toFixed(2);
}
