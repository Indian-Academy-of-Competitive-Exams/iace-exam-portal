/// <reference types="nativewind/types" />
import { useState } from 'react';
import { View } from 'react-native';
import { Text } from '../../src/components/ui/text';
import { ChipRow, type ChipOption } from '../../src/components/ui/chip-row';
import { LeaderboardPanel } from '../../src/components/performance/leaderboard-panel';
import { OverviewPanel } from '../../src/components/performance/overview-panel';

const OVERVIEW = 'overview';
const LEADERBOARD = 'leaderboard';

const VIEWS: readonly ChipOption[] = [
  { value: OVERVIEW, label: 'Overview' },
  { value: LEADERBOARD, label: 'Leaderboard' },
];

/** Their whole career, and where it stands against everyone else's. */
export default function PerformanceScreen() {
  const [view, setView] = useState(OVERVIEW);

  return (
    <View className="flex-1 bg-background">
      <View className="gap-3 px-5 pt-6">
        <Text variant="title">Performance</Text>
        <ChipRow options={VIEWS} value={view} onChange={setView} />
      </View>

      {view === LEADERBOARD ? <LeaderboardPanel /> : <OverviewPanel />}
    </View>
  );
}
