import { useSyncExternalStore } from 'react';
import { Link } from 'react-router-dom';
import { Upload } from 'lucide-react';
import {
  REVIEW_STATES,
  SECTION_SEATS,
  clockText,
  instituteDayLabel,
  type Assignment,
  type ReviewState,
  type SectionWork,
} from '@iace/contracts';
import { Button, Tabs, TabsContent, TabsList, TabsTrigger, TruncatedText, cn } from '@iace/ui';
import { REVIEW_STATE_LABELS } from '../../lib/labels';
import { ROUTES } from '../../lib/constants';
import { NEW_CARD } from './workspace-types';
import { liveTotal, type WorkClock } from './work-clock';
import type { Seat } from './section-seat';

/** The viewer's own seat in the panel, running with the cards' clocks so the two always add up. */
function OwnTimeStat({
  clock,
  held,
  cards,
}: Readonly<{ clock: WorkClock; held: number; cards: Parameters<typeof liveTotal>[2] }>) {
  const seconds = useSyncExternalStore(clock.subscribe, () => liveTotal(clock, held, cards));
  return <TimeStat seconds={seconds} />;
}

/** A seat's whole time on the section, as My sections totals it; summed off the questions listed only where that is not sent. */
function seatTime(work: SectionWork, seat: 'typist' | 'reader'): number | null {
  const whole = work[seat]?.secondsSpent ?? null;
  if (whole !== null) return whole;
  const own = work.seat === (seat === 'typist' ? SECTION_SEATS.TYPIST : SECTION_SEATS.READER);
  let total: number | null = null;
  for (const { time } of work.questions) {
    const seconds = time[seat] ?? (own ? time.own : null);
    if (seconds !== null) total = (total ?? 0) + seconds;
  }
  return total;
}

/** The section's progress, one tab per role: who holds it, what is pending, and a tile per question. */
export function ProgressPanel({
  work,
  seat,
  clock,
  activeKey,
  jump,
}: Readonly<{
  work: SectionWork;
  seat: Seat;
  /** Running only for the viewer's own seat, while the paper can still change. */
  clock: WorkClock | null;
  activeKey: string;
  jump: (key: string) => void;
}>) {
  const counts = countsOf(work);
  const ownSeat = work.seat === SECTION_SEATS.TYPIST ? 'typist' : 'reader';
  const timeOf = (role: 'typist' | 'reader') => {
    const held = seatTime(work, role);
    if (!clock || role !== ownSeat || held === null) return <TimeStat seconds={held} />;
    const cards = work.questions.map(({ questionId, time }) => [questionId, time.own] as const);
    // The blank card's seconds are on screen too, until its save names the question they belong to.
    return (
      <OwnTimeStat
        clock={clock}
        held={held}
        cards={seat.typing ? [...cards, [NEW_CARD, 0]] : cards}
      />
    );
  };
  const tiles = (
    <ol className="grid grid-cols-5 gap-1.5">
      {work.questions.map((question, index) => (
        <li key={question.questionId}>
          <button
            type="button"
            aria-label={`Question ${index + 1}, ${REVIEW_STATE_LABELS[question.review.state]}`}
            aria-current={question.questionId === activeKey ? 'true' : undefined}
            onClick={() => jump(question.questionId)}
            className={cn(
              'h-8 w-full rounded-md border text-xs tabular-nums transition-colors hover:bg-muted',
              'focus-visible:shadow-focus focus-visible:outline-none',
              TILE_TONE[question.review.state],
              question.questionId === activeKey && 'ring-2 ring-primary',
            )}
          >
            {index + 1}
          </button>
        </li>
      ))}
    </ol>
  );

  return (
    <Tabs defaultValue={work.seat === SECTION_SEATS.TYPIST ? 'typist' : 'reader'}>
      <TabsList>
        <TabsTrigger value="typist">Typist</TabsTrigger>
        <TabsTrigger value="reader">Proof-reader</TabsTrigger>
      </TabsList>
      <TabsContent value="typist" className="flex flex-col gap-3 pt-3">
        <Holder holder={work.typist} earlier={earlierOf(work, 'TYPIST')} />
        <DueStat holder={work.typist} />
        <Stat label="Written" value={`${counts.written} of ${work.questionCount}`} />
        <Stat label="Sent back to fix" value={counts.sentBack} />
        {timeOf('typist')}
        {seat.typing ? (
          <Button asChild size="sm" variant="outline">
            <Link to={ROUTES.AUTHORING_IMPORT(work.testId, work.baseConfigSectionId)}>
              <Upload aria-hidden />
              Import sheet
            </Link>
          </Button>
        ) : null}
        {tiles}
      </TabsContent>
      <TabsContent value="reader" className="flex flex-col gap-3 pt-3">
        <Holder holder={work.reader} earlier={earlierOf(work, 'PROOFREADER')} />
        <DueStat holder={work.reader} />
        <Stat label="Checked" value={`${counts.checked} of ${work.questions.length}`} />
        <Stat label="Sent back" value={counts.sentBack} />
        <Stat label="Fixed, to check again" value={counts.fixed} />
        {timeOf('reader')}
        {tiles}
      </TabsContent>
    </Tabs>
  );
}

const TILE_TONE: Record<ReviewState, string> = {
  [REVIEW_STATES.UNCHECKED]: 'border-border bg-surface',
  [REVIEW_STATES.CHECKED]: 'border-success/30 bg-success-subtle text-success-ink',
  [REVIEW_STATES.SENT_BACK]: 'border-warning/40 bg-warning-subtle text-warning-ink',
  [REVIEW_STATES.FIXED]: 'border-info/30 bg-info-subtle text-info-ink',
};

function countsOf(work: SectionWork) {
  const count = (state: ReviewState) =>
    work.questions.filter((question) => question.review.state === state).length;
  return {
    written: work.typist?.writtenCount ?? work.questions.length,
    checked: count(REVIEW_STATES.CHECKED),
    sentBack: count(REVIEW_STATES.SENT_BACK),
    fixed: count(REVIEW_STATES.FIXED),
  };
}

const earlierOf = (work: SectionWork, role: Assignment['role']) =>
  work.history.filter((row) => row.role === role);

function Holder({
  holder,
  earlier,
}: Readonly<{ holder: Assignment | null; earlier: readonly Assignment[] }>) {
  return (
    <div className="flex flex-col gap-1">
      <TruncatedText className="text-sm font-medium">
        {holder ? holder.assigneeName : 'Nobody yet'}
      </TruncatedText>
      {earlier.length > 0 ? (
        <TruncatedText className="text-xs text-muted-foreground">
          {`Earlier: ${earlier.map((row) => row.assigneeName).join(', ')}`}
        </TruncatedText>
      ) : null}
    </div>
  );
}

function DueStat({ holder }: Readonly<{ holder: Assignment | null }>) {
  return holder?.dueAt ? <Stat label="Due" value={instituteDayLabel(holder.dueAt)} /> : null;
}

function TimeStat({ seconds }: Readonly<{ seconds: number | null }>) {
  return seconds === null ? null : <Stat label="Time spent" value={clockText(seconds)} />;
}

function Stat({ label, value }: Readonly<{ label: string; value: string | number }>) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium tabular-nums">{value}</span>
    </div>
  );
}
