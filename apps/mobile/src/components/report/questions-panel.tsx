/// <reference types="nativewind/types" />
import { useMemo, useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import {
  distractorThatWon,
  percentLabel,
  QUESTION_FILTERS,
  questionReportInsights,
  type QuestionReport,
  type QuestionReportRow,
} from '@iace/contracts';
import { QUESTION_REPORT_FILTERS } from '@iace/app-kit';
import { questionReportQuery } from '../../lib/queries';
import { asText, useFilterState, type FilterState } from '../../lib/filters';
import { Alert } from '../ui/alert';
import { Badge, type BadgeVariant } from '../ui/badge';
import { Card } from '../ui/card';
import { FilterSummary, FilterTrigger } from '../ui/filter-bar';
import { EmptyState, EMPTY_STATE_KINDS } from '../ui/empty-state';
import { MeasureBars, type MeasureBar } from '../ui/measure-bars';
import { Skeleton } from '../ui/skeleton';
import { StatTile } from '../ui/stat-tile';

const DASH = '—';

/** What the paper said about them, which the score card shows the moment it is marked. */
const RESULTS: Readonly<Record<string, { label: string; variant: BadgeVariant }>> = {
  RIGHT: { label: 'Correct', variant: 'success' },
  WRONG: { label: 'Incorrect', variant: 'danger' },
  LEFT: { label: 'Skipped', variant: 'neutral' },
};

/** Every question of one sitting against the field's, which is where a clock is actually read. */
export function QuestionsPanel({ attemptId }: Readonly<{ attemptId: string }>) {
  const report = useQuery(questionReportQuery(attemptId));
  const state = useFilterState(QUESTION_REPORT_FILTERS);

  if (report.isLoading) {
    return (
      <View className="flex-1 gap-3 px-5 py-4">
        <Skeleton className="h-24 rounded-xl" />
        <Skeleton className="h-40 rounded-xl" />
      </View>
    );
  }

  if (!report.data) {
    return (
      <View className="flex-1 justify-center px-6">
        <EmptyState
          kind={EMPTY_STATE_KINDS.FAILURE}
          title="This question report did not load"
          onRetry={() => void report.refetch()}
        />
      </View>
    );
  }

  return <Body report={report.data} state={state} />;
}

function Body({ report, state }: Readonly<{ report: QuestionReport; state: FilterState }>) {
  // The list's own "Any result" row is the unset value, which is how a choice filter reads as off.
  const filter = asText(state.values.status) || QUESTION_FILTERS.ALL;
  const rows = useMemo(
    () => report.questions.filter((row) => matches(row, filter)),
    [report.questions, filter],
  );

  return (
    <FlatList
      className="flex-1 bg-background"
      contentContainerStyle={CONTENT_STYLE}
      data={rows}
      keyExtractor={(row) => row.questionId}
      renderItem={({ item }) => <Question row={item} />}
      ListHeaderComponent={<Header report={report} state={state} showing={rows.length} />}
      ListEmptyComponent={<EmptyState kind={EMPTY_STATE_KINDS.FILTERED} title="Nothing matches" />}
    />
  );
}

const CONTENT_STYLE = { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 40, gap: 12 };

function Header({
  report,
  state,
  showing,
}: Readonly<{ report: QuestionReport; state: FilterState; showing: number }>) {
  const insights = questionReportInsights(report.questions);

  return (
    <View className="gap-4 pb-1">
      <View className="flex-row flex-wrap gap-3">
        <StatTile label="Pace" value={paceOf(report.paceIndex)} />
        <StatTile label="Sittings" value={report.cohortSize} />
        <StatTile label="Questions" value={report.questions.length} />
        <StatTile label="Left blank, most answered" value={insights.blankButAnswerable} />
        <StatTile
          label="Time that bought nothing"
          value={percentLabel(insights.wastedShare, DASH)}
        />
      </View>

      <View className="flex-row items-center justify-between gap-3">
        <Text className="flex-1 text-sm text-muted-foreground">
          {`${showing} of ${report.questions.length}`}
        </Text>
        <FilterTrigger state={state} filters={QUESTION_REPORT_FILTERS} />
      </View>
      <FilterSummary state={state} filters={QUESTION_REPORT_FILTERS} />
    </View>
  );
}

function Question({ row }: Readonly<{ row: QuestionReportRow }>) {
  const [open, setOpen] = useState(false);
  const result = resultOf(row);
  const counted = row.optionCounts.some((option) => option.count > 0);

  return (
    <Card className="gap-3 p-4">
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        disabled={!counted}
        onPress={() => setOpen((shown) => !shown)}
        className="gap-3"
      >
        <View className="flex-row items-center justify-between gap-3">
          <Text className="text-base font-semibold text-foreground">{`Question ${row.order}`}</Text>
          <Badge variant={result.variant}>{result.label}</Badge>
        </View>

        <View className="flex-row flex-wrap gap-x-5 gap-y-1">
          <Figure label="Marks" value={row.marksAwarded ?? DASH} />
          <Figure label="Your time" value={seconds(row.timeSpentSec)} />
          <Figure label="Average time" value={seconds(row.cohortAverageTimeSec)} />
          <Figure label="Topper time" value={seconds(row.topperTimeSec)} />
          <Figure label="Attempted" value={percentLabel(asPercent(row.attemptRate), DASH)} />
          <Figure label="Got it right" value={percentLabel(asPercent(row.accuracy), DASH)} />
        </View>

        <View className="flex-row flex-wrap gap-x-5 gap-y-1 border-t border-border pt-3">
          <Figure label="Your answer" value={yourAnswer(row)} />
          <Figure label="Correct answer" value={correctAnswer(row)} />
        </View>
      </Pressable>

      {open && counted ? <Distribution row={row} /> : null}
    </Card>
  );
}

function Figure({ label, value }: Readonly<{ label: string; value: string | number }>) {
  return (
    <View className="flex-row items-baseline gap-2">
      <Text className="text-xs text-muted-foreground">{label}</Text>
      <Text className="text-sm font-medium text-foreground">{value}</Text>
    </View>
  );
}

/** How the cohort split across the options, which one the key names, and which one was theirs. */
function Distribution({ row }: Readonly<{ row: QuestionReportRow }>) {
  const total = row.optionCounts.reduce((sum, option) => sum + option.count, 0);
  const won = distractorThatWon(row);
  const bars: MeasureBar[] = row.optionCounts.map((option) => ({
    key: option.optionId,
    label: `Option ${option.position}${optionMark(option, row.selectedOptionId)}`,
    value: option.count,
    tone: option.isCorrect ? 2 : 1,
  }));

  return (
    <View className="gap-3 border-t border-border pt-3">
      <MeasureBars bars={bars} max={total} />
      {won === null || won.isCorrect || row.isCorrect === true ? null : (
        <Alert variant="warning">
          {`Option ${won.position} pulled ${won.count} of ${total} — the same wrong answer most of the field reached for.`}
        </Alert>
      )}
    </View>
  );
}

/** Names both facts a bar can carry, so the key and the reader's own pick never need two charts. */
function optionMark(
  option: Readonly<{ isCorrect: boolean; optionId: string }>,
  chosen: string | null,
): string {
  const marks = [option.isCorrect ? 'correct' : null, option.optionId === chosen ? 'yours' : null];
  const named = marks.filter((mark) => mark !== null);
  return named.length === 0 ? '' : ` — ${named.join(', ')}`;
}

function resultOf(row: QuestionReportRow) {
  if (row.isCorrect === true) return RESULTS.RIGHT;
  return row.isCorrect === false ? RESULTS.WRONG : RESULTS.LEFT;
}

function matches(row: QuestionReportRow, filter: string): boolean {
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

/** Above one is slower than the field, below it faster; the word says which without a sentence. */
function paceOf(pace: number | null): string {
  if (pace === null) return DASH;
  return `${pace} ${pace > 1 ? 'slower' : 'faster'}`;
}

const asPercent = (ratio: number | null) => (ratio === null ? null : ratio * 100);

const seconds = (value: number | null) => (value === null ? DASH : `${Math.round(value)}s`);
