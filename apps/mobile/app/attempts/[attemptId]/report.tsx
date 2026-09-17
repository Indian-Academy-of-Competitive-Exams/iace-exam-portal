/// <reference types="nativewind/types" />
import { useState } from 'react';
import { Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { REPORT_TABS, type ReportTab } from '@iace/app-kit';
import { scoreCardQuery } from '../../../src/lib/queries';
import { ChipRow, type ChipOption } from '../../../src/components/ui/chip-row';
import { ComparePanel } from '../../../src/components/report/compare-panel';
import { ScoreCardPanel } from '../../../src/components/report/score-card-panel';
import { SubjectsPanel } from '../../../src/components/report/subjects-panel';

const SCORE_CARD: ReportTab = '';
const SUBJECTS: ReportTab = 'subjects';
const COMPARE: ReportTab = 'compare';

/** The panels this app draws; the web's solution and question tabs are not built here yet. */
const BUILT: readonly ReportTab[] = [SCORE_CARD, SUBJECTS, COMPARE];

const TABS: readonly ChipOption[] = REPORT_TABS.filter((tab) => BUILT.includes(tab.path)).map(
  (tab) => ({ value: tab.path, label: tab.label }),
);

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
      {tab === COMPARE ? <ComparePanel attemptId={attemptId} /> : null}
      {tab === SCORE_CARD ? <ScoreCardPanel attemptId={attemptId} /> : null}
    </View>
  );
}
