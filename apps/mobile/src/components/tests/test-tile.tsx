import { Pressable, View } from 'react-native';
import { useUnstableNativeVariable } from 'nativewind';
import ChevronRight from 'lucide-react-native/icons/chevron-right';
import { Link, router } from 'expo-router';
import {
  ATTEMPT_STATUS,
  TEST_BUCKET,
  TEST_SHUT,
  instituteDateTimeLabel,
  instituteDayLabel,
  type StudentCatalogTest,
} from '@iace/contracts';
import { ordinal, shutOf, shutReason, type Sittable, type TestResult } from '@iace/app-kit';
import { Text } from '../ui/text';
import { Button } from '../ui/button';
import { Card } from '../ui/card';
import { useTokenColor } from '../../lib/use-token-color';
import { cn } from '../../lib/cn';
import { DETAIL_ROUTES } from '../../lib/nav';
import RotateCcw from 'lucide-react-native/icons/rotate-ccw';
import Play from 'lucide-react-native/icons/play';

/** The pill is read before anything else, so it carries the one fact a shelf is scanned for. */
const STATES = {
  DONE: {
    pill: 'bg-success-subtle',
    ink: 'text-success-ink',
    label: 'Done',
    wash: '--success-subtle',
    alpha: 0.3,
  },
  LIVE: {
    pill: 'bg-primary-subtle',
    ink: 'text-primary-ink',
    label: 'Open now',
    wash: '--primary-subtle',
    alpha: 0.3,
  },
  RUNNING: {
    pill: 'bg-warning-subtle',
    ink: 'text-warning-ink',
    label: 'In progress',
    wash: '--warning-subtle',
    alpha: 0.3,
  },
  SHUT: {
    pill: 'bg-muted',
    ink: 'text-muted-foreground',
    label: 'Scheduled',
    wash: '--muted',
    alpha: 0.4,
  },
} as const;

export interface TestTileProps {
  row: Sittable;
  now: Date;
  result?: TestResult;
  /** The shelf's fixed-width card; the series page's own list wants the full row instead. */
  fullWidth?: boolean;
}

/** The whole card is the tap target — it opens the test, whatever state it is in. */
export function TestTile({ row, now, result, fullWidth = false }: Readonly<TestTileProps>) {
  const state = STATES[stateOf(row)];
  const wash = useTokenColor(state.wash);
  const surface = useTokenColor('--surface');

  return (
    <Link href={DETAIL_ROUTES.TEST(row.test.id)} asChild>
      <Pressable>
        <Card
          className={cn('gap-3 p-4', fullWidth ? 'w-full' : 'w-72 shrink-0')}
          style={washOf(wash, surface, state.alpha)}
        >
          <Text
            className={cn(
              'self-start rounded-full px-2 py-0.5 text-xs font-semibold',
              state.pill,
              state.ink,
            )}
          >
            {pillOf(stateOf(row) === 'SHUT' ? shutLabel(row.test, now) : state.label, result)}
          </Text>

          <Text numberOfLines={1} className="text-base font-semibold text-foreground">
            {row.test.title ?? 'Untitled test'}
          </Text>

          <PaperFacts test={row.test} now={now} />

          <TileFoot row={row} result={result} />
        </Card>
      </Pressable>
    </Link>
  );
}

/** A sat paper shows what it scored, unless a retake of it is running; anything else shows what this card leads to. */
function ReportLink({ attemptId }: Readonly<{ attemptId: string }>) {
  const ink = useUnstableNativeVariable('--primary-ink');

  return (
    <Pressable
      accessibilityRole="link"
      hitSlop={8}
      onPress={() => router.push(DETAIL_ROUTES.REPORT(attemptId))}
      className="flex-row items-center gap-0.5"
    >
      <Text className="text-xs font-semibold text-primary-ink">Report</Text>
      <ChevronRight size={14} color={typeof ink === 'string' ? ink : undefined} />
    </Pressable>
  );
}

function TileFoot({ row, result }: Readonly<{ row: Sittable; result?: TestResult }>) {
  if (result && row.action !== 'RESUME') {
    return (
      <View className="flex-row items-center justify-between gap-2">
        <Text className="text-lg font-semibold tabular-nums text-foreground">
          {result.score}
          <Text variant="metaStrong"> /{result.maxMarks}</Text>
        </Text>
        <ReportLink attemptId={result.attemptId} />
      </View>
    );
  }

  if (row.action) {
    return (
      <Button
        size="sm"
        variant={row.action === 'RESUME' ? 'warning' : 'default'}
        icon={row.action === 'RESUME' ? RotateCcw : Play}
        onPress={() => router.push(DETAIL_ROUTES.TEST(row.test.id))}
      >
        {row.action === 'RESUME' ? 'Resume' : 'Start test'}
      </Button>
    );
  }

  return (
    <Button
      size="sm"
      variant="outline"
      onPress={() => router.push(DETAIL_ROUTES.TEST(row.test.id))}
    >
      View details
    </Button>
  );
}

function stateOf(row: Sittable): keyof typeof STATES {
  if (row.test.attemptStatus === ATTEMPT_STATUS.IN_PROGRESS) return 'RUNNING';
  if (row.bucket === TEST_BUCKET.DONE) return 'DONE';
  return row.bucket === TEST_BUCKET.OPEN ? 'LIVE' : 'SHUT';
}

/** A finished paper's pill carries its percentile, which is the fact the reader came for. */
function pillOf(label: string, result?: TestResult): string {
  if (result?.percentile != null) return `${label} · ${ordinal(result.percentile)}`;
  return label;
}

/** Scheduled is only true of an opening still ahead; a hold or a turn is named for what it is. */
const shutLabel = (test: StudentCatalogTest, now: Date): string =>
  shutOf(test, now) === TEST_SHUT.NOT_OPEN ? STATES.SHUT.label : shutReason(test, now);

function PaperFacts({ test, now }: Readonly<{ test: StudentCatalogTest; now: Date }>) {
  const opens = opensOn(test, now);

  return (
    <View className="gap-1.5 rounded-md border border-border bg-muted px-3 py-2">
      <Fact label="Sections" value={test.sectionCount} />
      <Fact label="Questions" value={test.totalQuestions} />
      <Fact label="Duration (minutes)" value={Math.round(test.durationSec / 60)} />
      {opens ? <Fact label="Opens" value={opens} /> : null}
    </View>
  );
}

function Fact({ label, value }: Readonly<{ label: string; value: string | number }>) {
  return (
    <View className="flex-row items-baseline justify-between gap-3">
      <Text variant="meta">{label}</Text>
      <Text variant="metaStrong" className="shrink text-right">
        {value}
      </Text>
    </View>
  );
}

/** A test opens and never shuts, so the only date worth naming is one still ahead. */
function opensOn(test: StudentCatalogTest, now: Date): string | null {
  if (test.opensAt === null || Date.parse(test.opensAt) <= now.getTime()) return null;
  // Startable with its opening still ahead is the grace, and then the MINUTE is the useful fact.
  if (test.canStart) return `${instituteDateTimeLabel(test.opensAt)} — you can begin now`;
  return instituteDayLabel(test.opensAt);
}

/** The web tile's top-down fade into the card colour, settled by 45%; no wash if a token is not a plain hex. */
function washOf(wash: string | undefined, surface: string | undefined, alpha: number) {
  if (!wash || !surface || !/^#[0-9a-f]{6}$/i.test(wash)) return undefined;
  const a = Math.round(alpha * 255)
    .toString(16)
    .padStart(2, '0');
  return {
    experimental_backgroundImage: `linear-gradient(to bottom, ${wash}${a}, ${surface} 45%)`,
  };
}
