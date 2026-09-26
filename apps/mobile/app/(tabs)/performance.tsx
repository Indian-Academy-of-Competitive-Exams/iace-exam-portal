/// <reference types="nativewind/types" />
import { useState } from 'react';
import { View } from 'react-native';
import { ChipRow, type ChipOption } from '../../src/components/ui/chip-row';
import { ScreenTitle } from '../../src/components/ui/hero';
import { TourTrigger, usePageTour, useTourTarget } from '../../src/lib/page-tour';
import { PERFORMANCE_TOUR, TOUR_IDS, TOUR_TARGETS } from '../../src/lib/tours';
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
  const views = useTourTarget(TOUR_TARGETS.PERFORMANCE_VIEWS);
  const panel = useTourTarget(TOUR_TARGETS.PERFORMANCE_PANEL);
  usePageTour({ id: TOUR_IDS.PERFORMANCE, steps: PERFORMANCE_TOUR, ready: true });

  return (
    <View className="flex-1 bg-background">
      <View className="gap-3 px-5 pt-6">
        <ScreenTitle action={<TourTrigger />}>Performance</ScreenTitle>
        <View {...views}>
          <ChipRow options={VIEWS} value={view} onChange={setView} />
        </View>
      </View>

      <View className="flex-1" {...panel}>
        {view === LEADERBOARD ? <LeaderboardPanel /> : <OverviewPanel />}
      </View>
    </View>
  );
}
