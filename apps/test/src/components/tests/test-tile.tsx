import { Link } from 'react-router-dom';
import { Button, Card, TruncatedText, cn, linkVariants, plural } from '@iace/ui';
import {
  ATTEMPT_STATUS,
  INSTITUTE_TIME_ZONE,
  TEST_BUCKET,
  type StudentCatalogTest,
} from '@iace/contracts';
import { ROUTES } from '../../lib/constants';
import { type Sittable, type TestResult } from '../../lib/catalog';

const WHEN = new Intl.DateTimeFormat('en-IN', {
  timeZone: INSTITUTE_TIME_ZONE,
  dateStyle: 'medium',
});

/** The wash is scanned across a shelf; the pill is read. Held under the pill so it stays legible. */
const STATES = {
  DONE: {
    wash: 'from-success-subtle/60',
    pill: 'bg-success-subtle text-success-ink',
    label: 'Done',
  },
  LIVE: {
    wash: 'from-primary-subtle/60',
    pill: 'bg-primary-subtle text-primary-ink',
    label: 'Open now',
  },
  RUNNING: {
    wash: 'from-warning-subtle/60',
    pill: 'bg-warning-subtle text-warning-ink',
    label: 'In progress',
  },
  SHUT: { wash: 'from-muted/70', pill: 'bg-muted text-muted-foreground', label: 'Scheduled' },
} as const;

/** The tile's body opens what the test IS; its foot does the one thing there is to do. */
export function TestTile({
  row,
  now,
  result,
}: Readonly<{ row: Sittable; now: Date; result?: TestResult }>) {
  const state = STATES[stateOf(row)];

  return (
    <Card
      className={cn(
        'flex w-72 shrink-0 snap-start flex-col bg-gradient-to-b to-card to-70%',
        state.wash,
      )}
    >
      <div className="flex flex-1 flex-col gap-3 p-4">
        <span className={cn('w-fit rounded-full px-2 py-0.5 text-xs font-semibold', state.pill)}>
          {pillOf(row, state.label, result)}
        </span>

        <Link to={ROUTES.TEST_ABOUT(row.test.id)} className="flex min-w-0 flex-col gap-1">
          <TruncatedText className="text-md font-semibold text-foreground">
            {row.test.title ?? 'Untitled test'}
          </TruncatedText>
        </Link>

        <p className="text-xs text-muted-foreground">{paperLine(row.test)}</p>
        <p className="text-xs text-muted-foreground">{whenLine(row.test, now)}</p>

        <div className="mt-auto pt-1">
          <TileFoot row={row} result={result} />
        </div>
      </div>
    </Card>
  );
}

/** A sat paper shows what it scored; anything else shows the one thing there is to press. */
function TileFoot({ row, result }: Readonly<{ row: Sittable; result?: TestResult }>) {
  if (result) {
    return (
      <div className="flex items-center justify-between gap-2">
        <span className="text-lg font-semibold tabular-nums text-foreground">
          {result.score}
          <span className="text-xs font-medium text-muted-foreground">/{result.maxMarks}</span>
        </span>
        <Link
          className={cn(linkVariants(), 'text-xs font-semibold')}
          to={ROUTES.REPORT(result.attemptId)}
        >
          Report
        </Link>
      </div>
    );
  }

  if (row.action) {
    return (
      <Button asChild size="sm" className="w-full">
        <Link to={ROUTES.TEST_INSTRUCTIONS(row.test.id)}>
          {row.action === 'RESUME' ? 'Resume' : 'Start test'}
        </Link>
      </Button>
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

/** A finished paper's pill carries its percentile, which is the fact the reader came for. */
function pillOf(row: Sittable, label: string, result?: TestResult): string {
  if (result?.percentile != null) return `${label} · ${result.percentile}th`;
  if (row.bucket === TEST_BUCKET.MISSED) return 'Entry closed';
  return label;
}

const paperLine = (test: StudentCatalogTest) =>
  [
    plural(test.totalQuestions, 'question'),
    `${Math.round(test.durationSec / 60)} minutes`,
    test.sittingCount === null ? null : `${test.sittingCount} sat`,
  ]
    .filter((part) => part !== null)
    .join(' · ');

function whenLine(test: StudentCatalogTest, now: Date): string {
  if (test.opensAt !== null && Date.parse(test.opensAt) > now.getTime()) {
    return `Opens ${WHEN.format(new Date(test.opensAt))}`;
  }
  if (test.closesAt !== null) {
    const closed = Date.parse(test.closesAt) <= now.getTime();
    return `${closed ? 'Entry closed' : 'Entry closes'} ${WHEN.format(new Date(test.closesAt))}`;
  }
  return 'Any time';
}
