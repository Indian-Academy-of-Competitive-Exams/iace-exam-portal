import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Alert,
  Badge,
  Combobox,
  DataTable,
  LoadingState,
  MeasureBars,
  Metric,
  MetricGroup,
  PageFrame,
  PageHeader,
  SectionHeading,
  TruncatedText,
  type DataTableColumn,
  type MeasureBar,
} from '@iace/ui';
import { PageCrumbs } from '@iace/app-kit/browser';
import {
  QUESTION_FILTERS,
  SYSTEM_DIFFICULTY,
  percentLabel,
  type QuestionFilter,
  type QuestionReport,
  type QuestionReportRow,
} from '@iace/contracts';
import { api } from '../lib/api';
import { NAV_ITEMS, questionReportQueryKey } from '../lib/constants';

const DASH = '—';

const FILTERS: readonly { value: QuestionFilter; label: string }[] = [
  { value: QUESTION_FILTERS.ALL, label: 'All questions' },
  { value: QUESTION_FILTERS.CORRECT, label: 'Correct' },
  { value: QUESTION_FILTERS.INCORRECT, label: 'Incorrect' },
  { value: QUESTION_FILTERS.UNATTEMPTED, label: 'Unattempted' },
];

/** The cohort found it easy, average or hard — their verdict, not the author's. */
const SYSTEM_TONES: Record<string, 'success' | 'warning' | 'danger'> = {
  [SYSTEM_DIFFICULTY.EASY]: 'success',
  [SYSTEM_DIFFICULTY.MEDIUM]: 'warning',
  [SYSTEM_DIFFICULTY.HARD]: 'danger',
};

/** What the paper said about them, which the score card shows the moment it is marked. */
const RESULTS = {
  RIGHT: { label: 'Correct', variant: 'success' },
  WRONG: { label: 'Incorrect', variant: 'danger' },
  LEFT: { label: 'Skipped', variant: 'neutral' },
} as const;

export function QuestionReportPage() {
  const { attemptId = '' } = useParams();
  const [filter, setFilter] = useState<QuestionFilter>(QUESTION_FILTERS.ALL);
  const report = useQuery({
    queryKey: questionReportQueryKey(attemptId),
    queryFn: () => api.me.questionReport(attemptId),
  });

  return (
    <PageFrame
      header={
        <PageHeader
          breadcrumbs={
            <PageCrumbs
              nav={NAV_ITEMS}
              tail={[{ label: report.data?.testTitle ?? 'Question report' }]}
            />
          }
          title="Question report"
          meta={report.data ? cohortMeta(report.data) : undefined}
        />
      }
    >
      {report.isLoading ? <LoadingState /> : null}
      {report.data ? <Body report={report.data} filter={filter} onFilter={setFilter} /> : null}
    </PageFrame>
  );
}

function Body({
  report,
  filter,
  onFilter,
}: Readonly<{
  report: QuestionReport;
  filter: QuestionFilter;
  onFilter: (filter: QuestionFilter) => void;
}>) {
  const rows = useMemo(
    () => report.questions.filter((row) => matches(row, filter)),
    [report.questions, filter],
  );
  const columns = useMemo(() => columnsFor(report.solutionsOpen), [report.solutionsOpen]);

  return (
    <div className="flex flex-col gap-6">
      {report.closedReason === null ? null : (
        /* ui-copy-ok: consequence */
        <Alert variant="info">{report.closedReason}</Alert>
      )}

      <MetricGroup>
        <Metric label="Pace" value={report.paceIndex ?? DASH} unit={paceUnit(report.paceIndex)} />
        <Metric label="Cohort" value={report.cohortSize} unit="sittings" />
      </MetricGroup>

      <div className="flex min-h-0 flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <SectionHeading title="Questions" />
          <Combobox
            value={filter}
            onChange={(value) => onFilter(value as QuestionFilter)}
            items={FILTERS.map((row) => ({ value: row.value, label: row.label }))}
            clearable={false}
            aria-label="Show"
            className="w-48"
          />
        </div>
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(row) => row.questionId}
          isLoading={false}
          empty={
            filter === QUESTION_FILTERS.ALL
              ? 'This paper served no questions.'
              : 'No question matches that filter.'
          }
          expand={
            report.solutionsOpen
              ? {
                  render: (row) => <Distribution row={row} />,
                  label: (row) => `Answers to question ${row.order}`,
                }
              : undefined
          }
        />
      </div>
    </div>
  );
}

/** How the cohort split across the options, and which one the key names. */
function Distribution({ row }: Readonly<{ row: QuestionReportRow }>) {
  if (row.optionCounts.length === 0) {
    return <p className="text-sm text-muted-foreground">{DASH}</p>;
  }
  const bars: MeasureBar[] = row.optionCounts.map((option) => ({
    key: option.optionId,
    label: `Option ${option.position}${option.isCorrect ? ' — correct' : ''}`,
    value: option.count,
    tone: option.isCorrect ? 2 : 1,
  }));
  const total = row.optionCounts.reduce((sum, option) => sum + option.count, 0);

  return <MeasureBars bars={bars} max={total} />;
}

function columnsFor(solutionsOpen: boolean): DataTableColumn<QuestionReportRow>[] {
  const columns: DataTableColumn<QuestionReportRow>[] = [
    { key: 'order', header: '#', numeric: true, cell: (row) => row.order },
    {
      key: 'result',
      header: 'Result',
      cell: (row) => {
        const held = resultOf(row);
        return <Badge variant={held.variant}>{held.label}</Badge>;
      },
    },
    { key: 'yourMarks', header: 'Marks', numeric: true, cell: (row) => row.marksAwarded ?? DASH },
    {
      key: 'yourTime',
      header: 'Your time',
      numeric: true,
      cell: (row) => seconds(row.timeSpentSec),
    },
    {
      key: 'attemptRate',
      header: 'Attempted',
      numeric: true,
      cell: (row) => percentLabel(asPercent(row.attemptRate), DASH),
    },
    {
      key: 'accuracy',
      header: 'Accuracy',
      numeric: true,
      cell: (row) => percentLabel(asPercent(row.accuracy), DASH),
    },
    {
      key: 'cohortTime',
      header: 'Cohort time',
      numeric: true,
      cell: (row) => seconds(row.cohortAverageTimeSec),
    },
    {
      key: 'topperTime',
      header: 'Topper time',
      numeric: true,
      cell: (row) => seconds(row.topperTimeSec),
    },
    { key: 'authored', header: 'Difficulty', cell: (row) => row.predefinedDifficulty ?? DASH },
    {
      key: 'system',
      header: 'Cohort difficulty',
      cell: (row) =>
        row.systemDifficulty === null ? (
          DASH
        ) : (
          <Badge variant={SYSTEM_TONES[row.systemDifficulty]}>{row.systemDifficulty}</Badge>
        ),
    },
  ];

  if (!solutionsOpen) return columns;
  return [
    ...columns,
    {
      key: 'yours',
      header: 'Your answer',
      className: 'max-w-[10rem]',
      cell: (row) => <TruncatedText>{yourAnswer(row)}</TruncatedText>,
    },
    {
      key: 'correct',
      header: 'Correct answer',
      className: 'max-w-[10rem]',
      cell: (row) => <TruncatedText>{correctAnswer(row)}</TruncatedText>,
    },
  ];
}

function resultOf(row: QuestionReportRow) {
  if (row.isCorrect === true) return RESULTS.RIGHT;
  return row.isCorrect === false ? RESULTS.WRONG : RESULTS.LEFT;
}

function matches(row: QuestionReportRow, filter: QuestionFilter): boolean {
  if (filter === QUESTION_FILTERS.CORRECT) return row.isCorrect === true;
  if (filter === QUESTION_FILTERS.INCORRECT) return row.isCorrect === false;
  if (filter === QUESTION_FILTERS.UNATTEMPTED) return row.isCorrect === null;
  return true;
}

function yourAnswer(row: QuestionReportRow): string {
  if (row.typedAnswer !== null) return row.typedAnswer;
  const chosen = row.optionCounts.find((option) => option.optionId === row.selectedOptionId);
  return chosen === undefined ? DASH : `Option ${chosen.position}`;
}

function correctAnswer(row: QuestionReportRow): string {
  if (row.correctAnswer !== null) return row.correctAnswer;
  const correct = row.optionCounts.find((option) => option.isCorrect);
  return correct === undefined ? DASH : `Option ${correct.position}`;
}

function cohortMeta(report: QuestionReport): string {
  return `${report.questions.length} questions`;
}

/** Above one is slower than the field, below it faster; the unit says which without a sentence. */
function paceUnit(pace: number | null): string | undefined {
  if (pace === null) return undefined;
  return pace > 1 ? 'slower' : 'faster';
}

const asPercent = (ratio: number | null) => (ratio === null ? null : ratio * 100);

function seconds(value: number | null): string {
  return value === null ? DASH : `${Math.round(value)}s`;
}
