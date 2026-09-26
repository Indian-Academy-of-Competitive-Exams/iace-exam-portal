import { FlatList, Pressable, View } from 'react-native';
import { Link } from 'expo-router';
import { useUnstableNativeVariable } from 'nativewind';
import ChevronRight from 'lucide-react-native/icons/chevron-right';
import { type StudentCatalogSeries } from '@iace/contracts';
import { seriesProgress, type Sittable, type TestResult } from '@iace/app-kit';
import { Text } from '../ui/text';
import { useTourTarget } from '../../lib/page-tour';
import { plural } from '../../lib/plural';
import { DETAIL_ROUTES } from '../../lib/nav';
import { TestTile } from './test-tile';

export interface SeriesShelfProps {
  series: StudentCatalogSeries;
  rows: readonly Sittable[];
  now: Date;
  /** What each sat paper scored, keyed by test id — the screen already holds the trend. */
  results: ReadonlyMap<string, TestResult>;
  /** A page tour's anchor, given to the FIRST shelf only so the tour rings one of them. */
  tour?: string;
}

const keyOfTile = (row: Sittable) => row.test.id;
const gap = () => <View className="w-3" />;

/** A stable factory, not a component declared inside another — `now`/`results` close over it. */
const renderTile =
  (now: Date, results: ReadonlyMap<string, TestResult>) =>
  ({ item }: { item: Sittable }) => (
    <TestTile row={item} now={now} result={results.get(item.test.id)} />
  );

export function SeriesShelf({ series, rows, now, results, tour }: Readonly<SeriesShelfProps>) {
  const progress = seriesProgress(series);
  const chevronColor = useUnstableNativeVariable('--muted-foreground');
  const anchor = useTourTarget(tour);

  return (
    <View className="gap-3" {...anchor}>
      <Link href={DETAIL_ROUTES.SERIES(series.id)} asChild>
        <Pressable className="flex-row items-center gap-1">
          <Text
            numberOfLines={1}
            className="shrink text-lg font-semibold tracking-tight text-foreground"
          >
            {series.name}
          </Text>
          <ChevronRight
            size={16}
            color={typeof chevronColor === 'string' ? chevronColor : undefined}
          />
        </Pressable>
      </Link>
      <Text variant="muted">
        {plural(progress.total, 'test')} · {progress.done} sat
      </Text>

      <FlatList
        horizontal
        data={rows}
        keyExtractor={keyOfTile}
        renderItem={renderTile(now, results)}
        ItemSeparatorComponent={gap}
        showsHorizontalScrollIndicator={false}
      />
    </View>
  );
}
