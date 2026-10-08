/// <reference types="nativewind/types" />
import { useState } from 'react';
import { View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { dispositionLabel, isMarkingPending, useBookmarks, verdictOf } from '@iace/app-kit';
import { LANGUAGE_MODE, type ExamSection, type SolutionReport } from '@iace/contracts';
import { Text } from '../ui/text';
import { api } from '../../lib/api';
import { solutionsQuery } from '../../lib/queries';
import { ChipRow, type ChipOption } from '../ui/chip-row';
import { Button } from '../ui/button';
import { EmptyState, EMPTY_STATE_KINDS } from '../ui/empty-state';
import { Skeleton } from '../ui/skeleton';
import { ReviewContent } from '../review/review-content';
import { ReviewPalette, VERDICT_STYLE } from '../review/review-palette';

/** The paper again, once it is marked, a section at a time: their own answer, the marks and the key. */
export function SolutionsPanel({ attemptId }: Readonly<{ attemptId: string }>) {
  const [sectionId, setSectionId] = useState('');
  const solutions = useQuery(solutionsQuery(attemptId, sectionId));

  if (solutions.isLoading) {
    return (
      <View className="flex-1 gap-3 px-5 py-4">
        <Skeleton className="h-6 w-1/2 rounded-md" />
        <Skeleton className="flex-1 rounded-xl" />
      </View>
    );
  }

  if (isMarkingPending(solutions.error)) {
    return (
      <View className="flex-1 justify-center px-6">
        <EmptyState title="No marks yet" onRetry={() => void solutions.refetch()} />
      </View>
    );
  }

  if (!solutions.data) {
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

  return (
    <Paper
      attemptId={attemptId}
      solutions={solutions.data}
      sectionId={sectionId || (solutions.data.sectionId ?? '')}
      onSection={setSectionId}
    />
  );
}

function Paper({
  attemptId,
  solutions,
  sectionId,
  onSection,
}: Readonly<{
  attemptId: string;
  solutions: SolutionReport;
  sectionId: string;
  onSection: (sectionId: string) => void;
}>) {
  const inSection = solutions.questions;
  const [openId, setOpenId] = useState(inSection[0]?.questionId ?? '');
  const [palette, setPalette] = useState(false);
  const bookmark = useBookmarks(api, attemptId);

  // A section the reader has just switched to holds none of the ids the last one did, so it opens at its first.
  const at = Math.max(
    inSection.findIndex((row) => row.questionId === openId),
    0,
  );
  const question = inSection[at];

  if (!question) return <EmptyState title="No questions" className="px-6 py-10" />;

  const verdict = VERDICT_STYLE[verdictOf(question)];
  const disposition = dispositionLabel(question);
  const saved = bookmark.saved.has(question.questionId);

  return (
    <View className="flex-1">
      <View className="gap-3 px-5 py-3">
        {solutions.sections.length > 1 ? (
          <ChipRow
            scroll
            options={sectionOptions(solutions.sections)}
            value={sectionId}
            onChange={onSection}
          />
        ) : null}

        <View className="flex-row items-center justify-between gap-3">
          <Text variant="label">
            {[`Question ${question.order}`, verdict.label, disposition].filter(Boolean).join(' · ')}
          </Text>
          <Button
            variant="ghost"
            size="sm"
            loading={bookmark.pendingId === question.questionId}
            onPress={() => bookmark.onToggle(question.questionId)}
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

const sectionOptions = (sections: readonly ExamSection[]): ChipOption[] =>
  sections.map((section) => ({ value: section.id, label: section.name }));
