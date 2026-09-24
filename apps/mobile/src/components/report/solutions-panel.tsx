/// <reference types="nativewind/types" />
import { useState } from 'react';
import { View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AppException,
  ErrorCodes,
  LANGUAGE_MODE,
  type ExamSection,
  type ScoreCard,
  type SolutionReport,
} from '@iace/contracts';
import { Text } from '../ui/text';
import { api } from '../../lib/api';
import { bookmarksInAttemptQueryKey, savedQueryKey } from '../../lib/constants';
import { scoreCardQuery, solutionsQuery } from '../../lib/queries';
import { ChipRow, type ChipOption } from '../ui/chip-row';
import { Button } from '../ui/button';
import { EmptyState, EMPTY_STATE_KINDS } from '../ui/empty-state';
import { Skeleton } from '../ui/skeleton';
import { ReviewContent } from '../review/review-content';
import { ReviewPalette, VERDICT_STYLE } from '../review/review-palette';
import { verdictOf, type ReviewedQuestion } from '../review/review-protocol';

/** The paper again, once it is marked: their own answer beside the key, question by question. */
export function SolutionsPanel({ attemptId }: Readonly<{ attemptId: string }>) {
  const card = useQuery(scoreCardQuery(attemptId));
  // Refused until the gate opens, which is an ANSWER about this paper, not a failure to retry.
  const solutions = useQuery({ ...solutionsQuery(attemptId), retry: false });

  const refusal = AppException.is(solutions.error) ? solutions.error : null;

  if (card.isLoading || solutions.isLoading) {
    return (
      <View className="flex-1 gap-3 px-5 py-4">
        <Skeleton className="h-6 w-1/2 rounded-md" />
        <Skeleton className="flex-1 rounded-xl" />
      </View>
    );
  }

  if (refusal?.code === ErrorCodes.FORBIDDEN) {
    return (
      <View className="flex-1 justify-center px-6">
        <EmptyState
          kind={EMPTY_STATE_KINDS.REFUSED}
          title="The solutions are not open yet"
          // ui-copy-ok: rule — the server owns when the key opens, and says so
          hint={refusal.message}
        />
      </View>
    );
  }

  if (!card.data || !solutions.data) {
    return (
      <View className="flex-1 justify-center px-6">
        <EmptyState
          kind={EMPTY_STATE_KINDS.FAILURE}
          title="The solutions did not load"
          onRetry={() => void solutions.refetch()}
        />
      </View>
    );
  }

  return <Paper attemptId={attemptId} card={card.data} solutions={solutions.data} />;
}

function Paper({
  attemptId,
  card,
  solutions,
}: Readonly<{ attemptId: string; card: ScoreCard; solutions: SolutionReport }>) {
  const questions = merged(card, solutions);
  const [sectionId, setSectionId] = useState(solutions.sections[0]?.id ?? '');
  const [openId, setOpenId] = useState(questions[0]?.questionId ?? '');
  const [palette, setPalette] = useState(false);
  const bookmark = useBookmarks(attemptId);

  const inSection = questions.filter((row) => row.baseConfigSectionId === sectionId);
  const at = Math.max(
    inSection.findIndex((row) => row.questionId === openId),
    0,
  );
  const question = inSection[at];

  const openSection = (id: string) => {
    setSectionId(id);
    const first = questions.find((row) => row.baseConfigSectionId === id);
    if (first) setOpenId(first.questionId);
  };

  if (!question) return <EmptyState title="No questions" className="px-6 py-10" />;

  const verdict = VERDICT_STYLE[verdictOf(question)];
  const saved = bookmark.saved.has(question.questionId);

  return (
    <View className="flex-1">
      <View className="gap-3 px-5 py-3">
        {solutions.sections.length > 1 ? (
          <ChipRow
            scroll
            options={sectionOptions(solutions.sections)}
            value={sectionId}
            onChange={openSection}
          />
        ) : null}

        <View className="flex-row items-center justify-between gap-3">
          <Text variant="label">{`Question ${question.order} · ${verdict.label}`}</Text>
          <Button
            variant="ghost"
            size="sm"
            loading={bookmark.pendingId === question.questionId}
            onPress={() => bookmark.toggle(question.questionId)}
          >
            {saved ? 'Saved' : 'Save'}
          </Button>
        </View>
      </View>

      <ReviewContent
        question={question}
        languages={solutions.languages}
        languageMode={LANGUAGE_MODE.SINGLE}
      />

      <View className="flex-row items-center justify-between gap-3 border-t border-border bg-surface px-5 py-3">
        <Button
          variant="outline"
          size="sm"
          disabled={at === 0}
          onPress={() => setOpenId(inSection[at - 1]?.questionId ?? openId)}
        >
          Previous
        </Button>
        <Button variant="ghost" size="sm" onPress={() => setPalette(true)}>
          {`${at + 1} of ${inSection.length}`}
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={at >= inSection.length - 1}
          onPress={() => setOpenId(inSection[at + 1]?.questionId ?? openId)}
        >
          Next
        </Button>
      </View>

      <ReviewPalette
        questions={inSection}
        openId={question.questionId}
        open={palette}
        onClose={() => setPalette(false)}
        onOpenQuestion={setOpenId}
      />
    </View>
  );
}

/** One read for the whole sitting's stars, and one mutation that toggles whichever was pressed. */
function useBookmarks(attemptId: string) {
  const queryClient = useQueryClient();

  const stars = useQuery({
    queryKey: bookmarksInAttemptQueryKey(attemptId),
    queryFn: () => api.me.bookmarksInAttempt(attemptId),
  });

  const savedIdOf = new Map(
    (stars.data?.bookmarks ?? []).map((row) => [row.questionId, row.savedId]),
  );

  const toggle = useMutation({
    mutationFn: (questionId: string) => {
      const savedId = savedIdOf.get(questionId);
      return savedId === undefined
        ? api.me.bookmarkQuestion({ attemptId, questionId })
        : api.me.removeSavedQuestion(savedId);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: bookmarksInAttemptQueryKey(attemptId) });
      void queryClient.invalidateQueries({ queryKey: savedQueryKey() });
    },
  });

  return {
    saved: new Set(savedIdOf.keys()),
    pendingId: toggle.isPending ? (toggle.variables ?? null) : null,
    toggle: (questionId: string) => toggle.mutate(questionId),
  };
}

const sectionOptions = (sections: readonly ExamSection[]): ChipOption[] =>
  sections.map((section) => ({ value: section.id, label: section.name }));

/** Their own answers always; the key only where the gate let it through. */
function merged(card: ScoreCard, solutions: SolutionReport): ReviewedQuestion[] {
  const keyed = new Map(solutions.questions.map((row) => [row.questionId, row]));
  return card.questions.map((row) => ({ ...row, ...keyed.get(row.questionId) }));
}
