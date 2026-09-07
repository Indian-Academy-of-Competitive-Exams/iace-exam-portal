import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Alert,
  Badge,
  ListView,
  LoadingState,
  MeasureBars,
  Metric,
  MetricGroup,
  TruncatedText,
  type DataTableColumn,
  type ListFilter,
  type ListState,
  type MeasureBar,
} from '@iace/ui';
import {
  QUESTION_FILTERS,
  SYSTEM_DIFFICULTY,
  percentLabel,
  type QuestionFilter,
  type QuestionReport,
  type QuestionReportRow,
} from '@iace/contracts';
import { api } from '../lib/api';
import { questionReportQueryKey } from '../lib/constants';

const DASH = '—';

/** The list's own "Any …" row is the empty value, which is how ListView reads a filter as unset. */
const STATUS_FILTER: ListFilter = {
  key: 'status',
  kind: 'choice',
  label: 'Result',
  primary: true,
  items: [
    { value: '', label: 'Any result' },
    { value: QUESTION_FILTERS.CORRECT, label: 'Correct' },
    { value: QUESTION_FILTERS.INCORRECT, label: 'Incorrect' },
    { value: QUESTION_FILTERS.UNATTEMPTED, label: 'Unattempted' },
  ],
};

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

export function QuestionReportPanel() {
  const { attemptId = '' } = useParams();
  const [filter, setFilter] = useState<QuestionFilter>(QUESTION_FILTERS.ALL);
  const report = useQuery({
    queryKey: questionReportQueryKey(attemptId),
    queryFn: () => api.me.questionReport(attemptId),
  });

  return (
    <>
      {report.isLoading ? <LoadingState /> : null}
      {report.data ? <Body report={report.data} filter={filter} onFilter={setFilter} /> : null}
    </>
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

  const list: ListState<QuestionReportRow> = {
    rows,
    isLoading: false,
    hasLoaded: true,
    values: { status: filter === QUESTION_FILTERS.ALL ? '' : filter },
    setFilter: (_key, value) => onFilter(chosen(value)),
    clearFilters: () => onFilter(QUESTION_FILTERS.ALL),
  };

  return (
    <div className="flex min-h-0 flex-col gap-6">
      {report.closedReason === null ? null : (
        /* ui-copy-ok: consequence */
        <Alert variant="info">{report.closedReason}</Alert>
      )}

      <MetricGroup>
        <Metric
          label="Pace"
          value={report.paceIndex ?? DASH}
          unit={paceUnit(report.paceIndex)}
          size="sm"
        />
        <Metric label="Cohort" value={report.cohortSize} unit="sittings" size="sm" />
        <Metric label="Questions" value={report.questions.length} size="sm" />
      </MetricGroup>

      <ListView
        list={list}
        filters={[STATUS_FILTER]}
        columns={columns}
        rowKey={(row) => row.questionId}
        empty="This paper served no questions."
        emptyFiltered="No question matches that filter."
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
  );
}

/** ListView speaks the filter's wire value; the empty one is this table's "any result". */
function chosen(value: unknown): QuestionFilter {
  const held = typeof value === 'string' ? value : '';
  return held === '' ? QUESTION_FILTERS.ALL : (held as QuestionFilter);
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

/** Above one is slower than the field, below it faster; the unit says which without a sentence. */
function paceUnit(pace: number | null): string | undefined {
  if (pace === null) return undefined;
  return pace > 1 ? 'slower' : 'faster';
}

const asPercent = (ratio: number | null) => (ratio === null ? null : ratio * 100);

function seconds(value: number | null): string {
  return value === null ? DASH : `${Math.round(value)}s`;
}
