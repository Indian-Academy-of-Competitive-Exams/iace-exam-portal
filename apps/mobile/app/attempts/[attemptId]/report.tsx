/// <reference types="nativewind/types" />
import { useState } from 'react';
import { Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { REPORT_TABS, type ReportTab } from '@iace/app-kit';
import { scoreCardQuery } from '../../../src/lib/queries';
import { ChipRow, type ChipOption } from '../../../src/components/ui/chip-row';
import { ComparePanel } from '../../../src/components/report/compare-panel';
import { QuestionsPanel } from '../../../src/components/report/questions-panel';
import { ScoreCardPanel } from '../../../src/components/report/score-card-panel';
import { SolutionsPanel } from '../../../src/components/report/solutions-panel';
import { SubjectsPanel } from '../../../src/components/report/subjects-panel';

const SCORE_CARD: ReportTab = '';
const SUBJECTS: ReportTab = 'subjects';
const SOLUTIONS: ReportTab = 'solutions';
const QUESTIONS: ReportTab = 'questions';
const COMPARE: ReportTab = 'compare';

const TABS: readonly ChipOption[] = REPORT_TABS.map((tab) => ({
  value: tab.path,
  label: tab.label,
}));

/** One sitting, whole. The tabs are a switch rather than routes: nobody deep-links on a phone. */
export default function ReportScreen() {
  const { attemptId = '' } = useLocalSearchParams<{ attemptId: string }>();
  const [tab, setTab] = useState<string>(SCORE_CARD);
  const title = useQuery(scoreCardQuery(attemptId)).data?.testTitle;

  return (
    <View className="flex-1 bg-background">
      <View className="gap-3 px-5 pt-4">
        {title ? (
          <Text className="text-2xl font-bold tracking-tight text-foreground" numberOfLines={2}>
            {title}
          </Text>
        ) : null}
        <ChipRow scroll options={TABS} value={tab} onChange={setTab} />
      </View>

      {tab === SUBJECTS ? <SubjectsPanel attemptId={attemptId} /> : null}
      {tab === SOLUTIONS ? <SolutionsPanel attemptId={attemptId} /> : null}
      {tab === QUESTIONS ? <QuestionsPanel attemptId={attemptId} /> : null}
      {tab === COMPARE ? <ComparePanel attemptId={attemptId} /> : null}
      {tab === SCORE_CARD ? <ScoreCardPanel attemptId={attemptId} /> : null}
    </View>
  );
}
