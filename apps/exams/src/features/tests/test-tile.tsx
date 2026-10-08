import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { Button, Card, StatRow, TruncatedText, cn, linkVariants } from '@iace/ui';
import {
  instituteDateTimeLabel,
  instituteDayLabel,
  ATTEMPT_STATUS,
  TEST_BUCKET,
  TEST_SHUT,
  type StudentCatalogTest,
} from '@iace/contracts';
import { ROUTES } from '../../lib/constants';
import { ordinal, shutOf, shutReason, type Sittable, type TestResult } from '@iace/app-kit';
import { StartSitting } from '../exam/start-sitting';
import { TOUR_TARGETS } from '../../lib/tours';

/** The wash is scanned across a shelf; the pill is read. Held under the pill so it stays legible. */
const STATES = {
  DONE: {
    wash: 'from-success-subtle/30',
    pill: 'bg-success-subtle text-success-ink',
    label: 'Done',
  },
  LIVE: {
    wash: 'from-primary-subtle/30',
    pill: 'bg-primary-subtle text-primary-ink',
    label: 'Open now',
  },
  RUNNING: {
    wash: 'from-warning-subtle/30',
    pill: 'bg-warning-subtle text-warning-ink',
    label: 'In progress',
  },
  SHUT: { wash: 'from-muted/40', pill: 'bg-muted text-muted-foreground', label: 'Scheduled' },
} as const;

/** The tile's body opens what the test IS; its foot does the one thing there is to do. */
export function TestTile({
  row,
  now,
  result,
}: Readonly<{ row: Sittable; now: Date; result?: TestResult }>) {
  const stands = stateOf(row);
  const state = STATES[stands];
  const opens = opensOn(row.test, now);

  return (
    <Card className={cn('flex min-w-0 flex-col bg-gradient-to-b to-card to-45%', state.wash)}>
      <div className="flex flex-1 flex-col gap-3 p-4">
        <span
          data-tour={TOUR_TARGETS.TEST_STATE}
          className={cn('w-fit rounded-full px-2 py-0.5 text-xs font-semibold', state.pill)}
        >
          {pillOf(stands === 'SHUT' ? shutLabel(row.test, now) : state.label, result)}
        </span>

        <Link to={ROUTES.TEST_ABOUT(row.test.id)} className="flex min-w-0 flex-col gap-1">
          <TruncatedText className="text-md font-semibold text-foreground">
            {row.test.title ?? 'Untitled test'}
          </TruncatedText>
        </Link>

        <div
          data-tour={TOUR_TARGETS.TEST_PATTERN}
          className="flex flex-col gap-1.5 rounded-md border border-border bg-muted px-3 py-2"
        >
          <StatRow label="Sections" value={row.test.sectionCount} />
          <StatRow label="Questions" value={row.test.totalQuestions} />
          <StatRow label="Duration (minutes)" value={Math.round(row.test.durationSec / 60)} />
          {opens ? <StatRow label="Opens" value={opens} /> : null}
        </div>

        <div data-tour={TOUR_TARGETS.TEST_ACTION} className="mt-auto pt-1">
          <TileFoot row={row} result={result} />
        </div>
      </div>
    </Card>
  );
}

/** A sat paper shows what it scored, unless a retake of it is running; anything else shows the one thing to press. */
function TileFoot({ row, result }: Readonly<{ row: Sittable; result?: TestResult }>) {
  if (result && row.action !== 'RESUME') {
    return (
      <div className="flex items-center justify-between gap-2">
        <span className="text-lg font-semibold tabular-nums text-foreground">
          {result.score}
          <span className="text-xs font-medium text-muted-foreground">/{result.maxMarks}</span>
        </span>
        <Link
          className={cn(
            linkVariants(),
            'inline-flex items-center gap-0.5 text-xs font-semibold [&_svg]:size-3.5',
          )}
          to={ROUTES.REPORT(result.attemptId)}
        >
          Report
          <ChevronRight aria-hidden />
        </Link>
      </div>
    );
  }

  if (row.action) {
    return (
      <StartSitting
        testId={row.test.id}
        resume={row.test.liveAttemptId}
        size="sm"
        className="w-full"
      >
        {row.action === 'RESUME' ? 'Resume' : 'Start test'}
      </StartSitting>
    );
  }

  return (
    <Button asChild size="sm" variant="outline" className="w-full">
      <Link to={ROUTES.TEST_ABOUT(row.test.id)}>View details</Link>
    </Button>
  );
}

function stateOf(row: Sittable): keyof typeof STATES {
  if (row.test.attemptStatus === ATTEMPT_STATUS.IN_PROGRESS) return 'RUNNING';
  if (row.bucket === TEST_BUCKET.DONE) return 'DONE';
  return row.bucket === TEST_BUCKET.OPEN ? 'LIVE' : 'SHUT';
}

/** Scheduled is only true of an opening still ahead; a hold or a turn is named for what it is. */
const shutLabel = (test: StudentCatalogTest, now: Date): string =>
  shutOf(test, now) === TEST_SHUT.NOT_OPEN ? STATES.SHUT.label : shutReason(test, now);

/** A finished paper's pill carries its percentile, which is the fact the reader came for. */
function pillOf(label: string, result?: TestResult): string {
  if (result?.percentile != null) return `${label} · ${ordinal(result.percentile)}`;
  return label;
}

/** A test opens and never shuts, so the only date worth naming is one still ahead. */
function opensOn(test: StudentCatalogTest, now: Date): string | null {
  if (test.opensAt === null || Date.parse(test.opensAt) <= now.getTime()) return null;
  // Startable with its opening still ahead is the grace, and then the MINUTE is the useful fact.
  if (test.canStart) return `${instituteDateTimeLabel(test.opensAt)} — you can begin now`;
  return instituteDayLabel(test.opensAt);
}
