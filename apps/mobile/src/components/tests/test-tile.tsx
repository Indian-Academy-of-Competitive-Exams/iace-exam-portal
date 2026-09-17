import { Pressable, Text, View } from 'react-native';
import { Link } from 'expo-router';
import {
  ATTEMPT_STATUS,
  TEST_BUCKET,
  instituteDayLabel,
  type StudentCatalogTest,
} from '@iace/contracts';
import { shutReason, type Sittable, type TestResult } from '@iace/app-kit';
import { Alert } from '../ui/alert';
import { Card } from '../ui/card';
import { cn } from '../../lib/cn';
import { plural } from '../../lib/plural';
import { DETAIL_ROUTES } from '../../lib/nav';

/** The pill is read before anything else, so it carries the one fact a shelf is scanned for. */
const STATES = {
  DONE: { pill: 'bg-success-subtle', ink: 'text-success-ink', label: 'Done' },
  LIVE: { pill: 'bg-primary-subtle', ink: 'text-primary-ink', label: 'Open now' },
  RUNNING: { pill: 'bg-warning-subtle', ink: 'text-warning-ink', label: 'In progress' },
  SHUT: { pill: 'bg-muted', ink: 'text-muted-foreground', label: 'Scheduled' },
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

  return (
    <Link href={DETAIL_ROUTES.TEST(row.test.id)} asChild>
      <Pressable>
        <Card className={cn('gap-3 p-4', fullWidth ? 'w-full' : 'w-72 shrink-0')}>
          <Text
            className={cn(
              'self-start rounded-full px-2 py-0.5 text-xs font-semibold',
              state.pill,
              state.ink,
            )}
          >
            {pillOf(state.label, result)}
          </Text>

          <Text numberOfLines={1} className="text-base font-semibold text-foreground">
            {row.test.title ?? 'Untitled test'}
          </Text>

          <Text className="text-xs text-muted-foreground">{paperLine(row.test)}</Text>

          {stateOf(row) === 'SHUT' ? (
            <Alert>{shutReason(row.test, now)}</Alert>
          ) : (
            <Text className="text-xs text-muted-foreground">{whenLine(row.test, now)}</Text>
          )}

          <TileFoot row={row} result={result} />
        </Card>
      </Pressable>
    </Link>
  );
}

/** A sat paper shows what it scored; anything else shows the one thing this card leads to. */
function TileFoot({ row, result }: Readonly<{ row: Sittable; result?: TestResult }>) {
  if (result) {
    return (
      <Text className="text-lg font-semibold tabular-nums text-foreground">
        {result.score}
        <Text className="text-xs font-medium text-muted-foreground"> /{result.maxMarks}</Text>
      </Text>
    );
  }

  if (row.action) {
    return (
      <View className="items-center rounded-md bg-primary px-3 py-2">
        <Text className="text-sm font-medium text-primary-foreground">
          {row.action === 'RESUME' ? 'Resume' : 'Start test'}
        </Text>
      </View>
    );
  }

  return (
    <View className="items-center rounded-md border border-input px-3 py-2">
      <Text className="text-sm font-medium text-foreground">View details</Text>
    </View>
  );
}

function stateOf(row: Sittable): keyof typeof STATES {
  if (row.test.attemptStatus === ATTEMPT_STATUS.IN_PROGRESS) return 'RUNNING';
  if (row.bucket === TEST_BUCKET.DONE) return 'DONE';
  return row.bucket === TEST_BUCKET.OPEN ? 'LIVE' : 'SHUT';
}

/** A finished paper's pill carries its percentile, which is the fact the reader came for. */
function pillOf(label: string, result?: TestResult): string {
  if (result?.percentile != null) return `${label} · ${result.percentile}th`;
  return label;
}

const paperLine = (test: StudentCatalogTest) =>
  [plural(test.totalQuestions, 'question'), `${Math.round(test.durationSec / 60)} minutes`].join(
    ' · ',
  );

/** A test opens and never shuts, so there are only two things to say about when. */
function whenLine(test: StudentCatalogTest, now: Date): string {
  if (test.opensAt !== null && Date.parse(test.opensAt) > now.getTime()) {
    return `Opens ${instituteDayLabel(test.opensAt)}`;
  }
  return 'Any time';
}
