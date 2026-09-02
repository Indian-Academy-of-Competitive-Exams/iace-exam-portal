import { Link } from 'react-router-dom';
import { CalendarClock, CircleCheck, LockKeyhole } from 'lucide-react';
import { Badge, Button, Card, CardContent, TruncatedText } from '@iace/ui';
import {
  ATTEMPT_STATUS,
  INSTITUTE_TIME_ZONE,
  TEST_BUCKET,
  type StudentCatalogTest,
} from '@iace/contracts';
import { ROUTES } from '../../lib/constants';
import { type Sittable } from '../../lib/catalog';

const WHEN = new Intl.DateTimeFormat('en-IN', {
  timeZone: INSTITUTE_TIME_ZONE,
  dateStyle: 'medium',
  timeStyle: 'short',
});

/** The tile's body opens what the test IS; its button does the one thing there is to do. */
export function TestTile({ row, now }: Readonly<{ row: Sittable; now: Date }>) {
  const { test } = row;
  const done = row.bucket === TEST_BUCKET.DONE;

  return (
    <Card className="flex w-72 shrink-0 snap-start flex-col">
      <CardContent className="flex flex-1 flex-col gap-3 p-4">
        <Link to={ROUTES.TEST_ABOUT(test.id)} className="flex min-w-0 flex-col gap-1">
          <TruncatedText className="text-md font-semibold text-foreground">
            {test.title ?? 'Untitled test'}
          </TruncatedText>
          <TruncatedText className="text-sm text-muted-foreground">{row.seriesName}</TruncatedText>
        </Link>

        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          {test.order === null ? null : <span className="tabular-nums">Test {test.order}</span>}
          {/* The Done badge already says a finished sitting is finished. */}
          {done || test.order === null ? null : <span aria-hidden>·</span>}
          {done ? null : <span>{sittingState(row)}</span>}
        </p>

        {done ? (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <CircleCheck aria-hidden className="size-3.5 shrink-0 text-success" />
            <Badge variant="success">Done</Badge>
          </p>
        ) : (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <CalendarClock aria-hidden className="size-3.5 shrink-0" />
            {whenLine(test, now)}
          </p>
        )}

        <div className="mt-auto">
          <TileAction row={row} now={now} done={done} />
        </div>
      </CardContent>
    </Card>
  );
}

/** Sit it, read it back, or be told plainly why neither is on offer yet. */
function TileAction({ row, now, done }: Readonly<{ row: Sittable; now: Date; done: boolean }>) {
  if (row.action) {
    return (
      <Button asChild size="sm" className="w-full">
        <Link to={ROUTES.TEST_INSTRUCTIONS(row.test.id)}>{buttonWord(row.action, done)}</Link>
      </Button>
    );
  }
  if (done) {
    return (
      <Button asChild size="sm" variant="outline" className="w-full">
        <Link to={ROUTES.TEST_ABOUT(row.test.id)}>Review</Link>
      </Button>
    );
  }
  return (
    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <LockKeyhole aria-hidden className="size-3.5 shrink-0" />
      {shutReason(row.test, now)}
    </p>
  );
}

/** Where an unfinished sitting stands — a state the action button only implies. */
function sittingState(row: Sittable): string {
  if (row.test.attemptStatus === ATTEMPT_STATUS.IN_PROGRESS) return 'In progress';
  if (row.test.attemptStatus === ATTEMPT_STATUS.SUBMITTED) return 'Awaiting marks';
  return 'Not started';
}

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

/** Why there is no button. "Waiting its turn" is not an error and must not read like one. */
function shutReason(test: StudentCatalogTest, now: Date): string {
  if (test.opensAt !== null && Date.parse(test.opensAt) > now.getTime()) return 'Not open yet';
  if (test.closesAt !== null && Date.parse(test.closesAt) <= now.getTime()) return 'Entry closed';
  return 'Waiting its turn';
}

/** A sat test with a retake left says so: "Start test" would read as though it never happened. */
function buttonWord(action: 'START' | 'RESUME', done: boolean): string {
  if (action === 'RESUME') return 'Resume';
  return done ? 'Sit it again' : 'Start';
}
