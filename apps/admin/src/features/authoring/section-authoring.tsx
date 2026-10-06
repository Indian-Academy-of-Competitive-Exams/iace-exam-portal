import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCheck, Info, Send, Trash2, Upload } from 'lucide-react';
import {
  AppException,
  DIFFICULTY_LEVEL,
  ErrorCodes,
  REVIEW_STATES,
  SECTION_SEATS,
  SEND_BACK_REASONS,
  clockText,
  instituteDayLabel,
  type Assignment,
  type QuestionTime,
  type ReviewState,
  type SectionQuestion,
  type SectionWork,
  type SendBackReason,
} from '@iace/contracts';
import {
  Alert,
  Badge,
  Button,
  ConfirmDialog,
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  EMPTY_STATE_KINDS,
  LoadingState,
  RadioGroup,
  RadioGroupItem,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TruncatedText,
  cn,
  type BadgeProps,
} from '@iace/ui';
import { api } from '../../lib/api';
import {
  QUERY_KEYS,
  REVIEW_STATE_LABELS,
  ROUTES,
  SECTION_QUESTION_PARAM,
  SEND_BACK_REASON_LABELS,
  sectionWorkHeldQueryKey,
  sectionWorkQueryKey,
} from '../../lib/constants';
import { useAuth } from '../../providers/auth';
import { useDeleteQuestion } from './use-delete-question';
import { SectionThreadButton } from '../../components/section-thread';
import { OtherTestsNotice } from './cross-test-warning';
import { TypistDoneDialog } from './typist-done-dialog';
import {
  AuthoringWorkspace,
  NEW_CARD,
  type Held,
  type WorkspaceCard,
  type WorkspaceSource,
} from './authoring-workspace';
import { headerOf, stateOf, toDraft } from './question-scaffold';
import { FinalizeAssignmentDialog } from './finalize-assignment-dialog';
import { useWorkClock } from './use-work-clock';
import { DueStandingBadge } from '../../components/due-standing-badge';
import { TimeSpent } from '../../components/time-spent';
import { type WorkClock } from './work-clock';

const REVIEW_BADGE: Record<ReviewState, BadgeProps['variant']> = {
  [REVIEW_STATES.UNCHECKED]: 'neutral',
  [REVIEW_STATES.CHECKED]: 'success',
  [REVIEW_STATES.SENT_BACK]: 'warning',
  [REVIEW_STATES.FIXED]: 'info',
};

/** How often a blocked screen asks whether the claim on its section has been given up. */
const CLAIM_POLL_MS = 10_000;

const REASON_ORDER = [
  SEND_BACK_REASONS.SPELLING,
  SEND_BACK_REASONS.DATA_CORRECTION,
  SEND_BACK_REASONS.ANSWER_OPTION,
] as const;

/** What the viewer can do right now, read off the section once for the page and every card. */
function seatOf(work: SectionWork) {
  const own = work.seatReplaced ? null : work.seat;
  return {
    reading: own === SECTION_SEATS.READER && Boolean(work.reader?.canMarkRead),
    typing: own === SECTION_SEATS.TYPIST && Boolean(work.typist?.canMarkDone),
    fixing: own === SECTION_SEATS.TYPIST && !work.offered,
  };
}

/** One section of one test as its typist, its proof-reader or the test's owner works it. */
export function SectionAuthoringPage() {
  const { testId = '', sectionId = '' } = useParams();
  const [search, setSearch] = useSearchParams();
  const queryClient = useQueryClient();
  const { identity } = useAuth();
  const work = useQuery({
    queryKey: sectionWorkQueryKey(testId, sectionId),
    queryFn: () => api.admin.sectionWork.one(testId, sectionId),
    retry: false,
    refetchInterval: (query) =>
      editingElsewhere(query.state.data, identity?.id) ? CLAIM_POLL_MS : false,
  });

  // The holder's saves landed while this screen was blocked, so its open cards read again before they are typed into.
  const blocked = editingElsewhere(work.data, identity?.id) !== null;
  const wasBlocked = useRef(false);
  useEffect(() => {
    if (wasBlocked.current && !blocked) {
      void queryClient.invalidateQueries({ queryKey: sectionWorkQueryKey(testId, sectionId) });
    }
    wasBlocked.current = blocked;
  }, [blocked, queryClient, testId, sectionId]);

  // Only the section and the card just written are read again; the queues and duplicate checks wait until next opened.
  const settle = useCallback(
    async (savedId?: string) => {
      for (const queryKey of [QUERY_KEYS.ASSIGNMENTS, QUERY_KEYS.AUTHORING]) {
        void queryClient.invalidateQueries({ queryKey, refetchType: 'none' });
      }
      const section = sectionWorkQueryKey(testId, sectionId);
      await queryClient.invalidateQueries({ queryKey: section, exact: true });
      if (savedId === undefined) return;
      await queryClient.invalidateQueries({
        queryKey: sectionWorkHeldQueryKey(testId, sectionId, savedId),
      });
    },
    [queryClient, testId, sectionId],
  );
  const replace = useCallback(
    (next: SectionWork) => queryClient.setQueryData(sectionWorkQueryKey(testId, sectionId), next),
    [queryClient, testId, sectionId],
  );
  const follow = useCallback(
    (key: string) => {
      if (key === NEW_CARD || search.get(SECTION_QUESTION_PARAM) === key) return;
      setSearch({ [SECTION_QUESTION_PARAM]: key }, { replace: true });
    },
    [search, setSearch],
  );

  if (work.isLoading) return <LoadingState>Loading the section</LoadingState>;
  if (work.error || !work.data) {
    const refused = AppException.is(work.error) && work.error.code === ErrorCodes.NOT_FOUND;
    return refused ? (
      <EmptyState
        kind={EMPTY_STATE_KINDS.REFUSED}
        title="This section is not yours to open"
        hint="Ask whoever builds the test to assign it to you."
      />
    ) : (
      <EmptyState
        kind={EMPTY_STATE_KINDS.FAILURE}
        title="Could not load this section"
        onRetry={work.refetch}
      />
    );
  }

  return (
    <SectionWorkspace
      work={work.data}
      startAt={search.get(SECTION_QUESTION_PARAM)}
      onActive={follow}
      onChanged={replace}
      onSettle={settle}
    />
  );
}

function SectionWorkspace({
  work,
  startAt,
  onActive,
  onChanged,
  onSettle,
}: Readonly<{
  work: SectionWork;
  startAt: string | null;
  onActive: (key: string) => void;
  onChanged: (next: SectionWork) => void;
  onSettle: (savedId?: string) => Promise<void>;
}>) {
  const seat = useMemo(() => seatOf(work), [work]);
  const { identity } = useAuth();
  const elsewhere = editingElsewhere(work, identity?.id);
  // A super admin's save takes the claim over, so they are told and never stopped.
  const blocked = elsewhere !== null && !identity?.isSuperAdmin;
  const [finishing, setFinishing] = useState(false);
  const [releasing, setReleasing] = useState(false);
  const { testId, baseConfigSectionId: sectionId } = work;

  // Time is counted for whoever holds a seat, while the paper can still change.
  const counting = !work.seatReplaced && work.seat !== SECTION_SEATS.OWNER && !work.offered;
  const [inView, setInView] = useState<string | null>(null);
  const clock = useWorkClock(testId, sectionId, counting ? inView : null);
  const follow = useCallback(
    (key: string) => {
      setInView(key);
      onActive(key);
    },
    [onActive],
  );

  const source = useMemo((): WorkspaceSource => {
    return {
      cards: work.questions.map((question, index) =>
        cardOf(
          work,
          question,
          index,
          { seat, clock: counting ? clock : null },
          onChanged,
          onSettle,
        ),
      ),
      query: (id) => ({
        queryKey: sectionWorkHeldQueryKey(testId, sectionId, id),
        queryFn: async (): Promise<Held> => {
          const question = await api.admin.sectionWork.question(testId, sectionId, id);
          return {
            header: headerOf(question),
            state: stateOf(question),
            stamp: question.updatedAt,
          };
        },
      }),
      save: async (id, held) => {
        // Refused if it moved since this card read it: an edit made elsewhere is not overwritten.
        await api.admin.sectionWork.edit(testId, sectionId, id, {
          ...toDraft(held.state, held.header),
          expectedUpdatedAt: held.stamp,
        });
        await onSettle(id);
      },
      subjectLocked: work.sectionSubjectId !== null,
      blocked,
      checkDuplicates: seat.typing,
      create: seat.typing
        ? {
            header: {
              subjectId: work.sectionSubjectId ?? '',
              topicId: '',
              difficulty: DIFFICULTY_LEVEL.MEDIUM,
              tags: '',
            },
            save: async (held) => {
              const created = await api.admin.sectionWork.create(
                testId,
                sectionId,
                toDraft(held.state, held.header),
              );
              clock.move(NEW_CARD, created.id);
              await onSettle();
            },
            lead: counting ? <OwnClock clock={clock} id={NEW_CARD} held={0} /> : undefined,
          }
        : undefined,
    };
  }, [work, seat, blocked, counting, clock, testId, sectionId, onChanged, onSettle]);

  const extra = (
    <>
      {seat.typing ? (
        <Button type="button" size="sm" variant="outline" onClick={() => setFinishing(true)}>
          <CheckCheck aria-hidden />
          Mark done
        </Button>
      ) : null}
      {work.canRelease ? (
        <Button type="button" size="sm" variant="outline" onClick={() => setReleasing(true)}>
          <Send aria-hidden />
          Release
        </Button>
      ) : null}
    </>
  );

  const title = <SectionTitle work={work} elsewhere={elsewhere} blocked={blocked} />;
  const empty = source.cards.length === 0 && !source.create;
  const thread = (
    <SectionThreadButton
      testId={testId}
      sectionId={sectionId}
      canWrite={!work.seatReplaced && work.seat !== SECTION_SEATS.OWNER}
    />
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <SectionState work={work} />
      {empty ? (
        <>
          <div className="flex flex-none items-center justify-between gap-3 border-b border-border bg-surface px-4 py-2">
            {title}
            {thread}
          </div>
          <EmptyState title={emptyTitle(work)} />
        </>
      ) : (
        <AuthoringWorkspace
          source={source}
          startAt={startAt}
          onActive={follow}
          title={title}
          saveLabel="Save and next"
          extraActions={
            <>
              {thread}
              {extra}
            </>
          }
          panel={{
            label: 'Section progress',
            render: (position) => <ProgressPanel work={work} {...position} />,
          }}
        />
      )}

      <TypistDoneDialog
        assignment={finishing ? work.typist : null}
        onClose={() => setFinishing(false)}
      />
      <FinalizeAssignmentDialog
        assignment={releasing && work.reader ? { ...work.reader, testTitle: work.testTitle } : null}
        covering={work.questions.length}
        onClose={() => setReleasing(false)}
        onFinalized={() => void onSettle()}
      />
    </div>
  );
}

function emptyTitle(work: SectionWork): string {
  if (work.seat === SECTION_SEATS.READER) return 'Nothing handed over yet';
  return 'No questions yet';
}

/** Which section of which test, ahead of the question in every card's language bar. */
function SectionTitle({
  work,
  elsewhere,
  blocked,
}: Readonly<{ work: SectionWork; elsewhere: string | null; blocked: boolean }>) {
  const own = [work.typist, work.reader].find((row) => row?.id === work.seatAssignmentId);
  return (
    <span className="flex min-w-0 items-center gap-2">
      {elsewhere ? <EditingElsewhere name={elsewhere} blocked={blocked} /> : null}
      <TruncatedText className="text-sm font-semibold">{work.sectionName}</TruncatedText>
      <TruncatedText className="text-sm text-muted-foreground">
        {work.testTitle ?? 'Untitled test'}
      </TruncatedText>
      {own?.dueAt ? (
        <>
          <span className="flex-none text-sm text-muted-foreground">
            {`Due ${instituteDayLabel(own.dueAt)}`}
          </span>
          <DueStandingBadge standing={own.standing} />
        </>
      ) : null}
    </span>
  );
}

/** Somebody else holds the section: a glyph in every card's bar says who, and takes no row from the question. */
function EditingElsewhere({ name, blocked }: Readonly<{ name: string; blocked: boolean }>) {
  const label = blocked
    ? `${name} is editing this section. It opens to you when they hand it on.`
    : `${name} is editing this section. Your save takes it over.`;
  return (
    <Tooltip>
      <TooltipTrigger
        type="button"
        aria-label={label}
        className="flex size-6 flex-none animate-pulse items-center justify-center rounded-full bg-warning-subtle text-warning-ink focus-visible:shadow-focus focus-visible:outline-none motion-reduce:animate-none [&_svg]:size-4"
      >
        <Info aria-hidden />
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/** Where the section stands, in the words each seat reads it by — only when there is something to say. */
function SectionState({ work }: Readonly<{ work: SectionWork }>) {
  const state = contextOf(work);
  if (!state) return null;
  return (
    <div className="flex flex-none flex-col gap-2 border-b border-border bg-surface px-4 py-2">
      <Alert variant={state.variant}>{state.text}</Alert>
    </div>
  );
}

/** Who else holds this section right now, by name; nobody when it is free or the viewer's own. */
function editingElsewhere(work: SectionWork | undefined, viewerId: string | undefined) {
  const editingBy = work?.editingBy;
  if (!editingBy || editingBy.adminId === viewerId) return null;
  return editingBy.fullName ?? 'Another admin';
}

function contextOf(
  work: SectionWork,
): { variant: 'info' | 'success' | 'warning'; text: string } | null {
  if (work.offered) {
    return {
      variant: 'warning',
      text: 'This test has been offered, so its questions no longer change here.',
    };
  }
  // A stood-down last typist still fixes their drafts, so "you can still read it" would be wrong.
  if (work.seatReplaced && !work.questions.some((question) => question.editable)) {
    const dropped = work.history.some(
      (row) => row.id === work.seatAssignmentId && row.sectionDropped,
    );
    return {
      variant: 'info',
      text: dropped
        ? 'This section left the test. You can still read it.'
        : 'This section has passed to somebody else. You can still read it.',
    };
  }
  const reader = work.reader;
  if (work.seat === SECTION_SEATS.READER) {
    if (!reader?.handedAt)
      return { variant: 'info', text: 'It reaches you when its typist or owner hands it over.' };
    if (reader.finalizedAt) return { variant: 'success', text: 'You released this section.' };
    return null;
  }
  if (work.seat === SECTION_SEATS.TYPIST && work.typist?.finalizedAt) {
    return {
      variant: 'info',
      text: 'Marked done. Only a question sent back to you can change now; anything new goes to the bank.',
    };
  }
  if (work.seat === SECTION_SEATS.OWNER && reader?.handedAt && !reader.finalizedAt) {
    return { variant: 'info', text: 'With its proof-reader until they release it.' };
  }
  return null;
}

function cardOf(
  work: SectionWork,
  question: SectionQuestion,
  index: number,
  { seat, clock }: { seat: ReturnType<typeof seatOf>; clock: WorkClock | null },
  onChanged: (next: SectionWork) => void,
  onSettle: (savedId?: string) => Promise<void>,
): WorkspaceCard {
  const { review, time } = question;
  return {
    key: question.questionId,
    editable: question.editable,
    lead: (
      <>
        <span className="text-sm font-semibold tabular-nums">
          {`Question ${index + 1} of ${work.questions.length}`}
        </span>
        <Badge variant={REVIEW_BADGE[review.state]}>{REVIEW_STATE_LABELS[review.state]}</Badge>
        {clock ? <OwnClock clock={clock} id={question.questionId} held={time.own} /> : null}
        {!clock && work.seat !== SECTION_SEATS.OWNER ? <TimeSpent seconds={time.own} /> : null}
        <SeatTimes time={time} />
      </>
    ),
    actions: (
      <CardActions
        work={work}
        question={question}
        seat={seat}
        onChanged={onChanged}
        onSettle={onSettle}
      />
    ),
    notice: <CardNotice work={work} question={question} />,
  };
}

/** The viewer's own time on one question, running while it is the one on screen. */
function OwnClock({ clock, id, held }: Readonly<{ clock: WorkClock; id: string; held: number }>) {
  const seconds = useSyncExternalStore(clock.subscribe, () => clock.shown(id, held));
  return <TimeSpent seconds={seconds} label="Time on this question" />;
}

/** Each seat's time on the question, for the owner and a super admin, who are sent both. */
function SeatTimes({ time }: Readonly<{ time: QuestionTime }>) {
  if (time.typist === null || time.reader === null) return null;
  return (
    <>
      <TimeSpent seat="Typist" seconds={time.typist} />
      <TimeSpent seat="Proof-reader" seconds={time.reader} />
    </>
  );
}

/** A seat's whole time on the section: every seat's for the owner, and their own for whoever holds one. */
function seatTime(work: SectionWork, seat: 'typist' | 'reader'): number | null {
  const own = work.seat === (seat === 'typist' ? SECTION_SEATS.TYPIST : SECTION_SEATS.READER);
  let total: number | null = null;
  for (const { time } of work.questions) {
    const seconds = time[seat] ?? (own ? time.own : null);
    if (seconds !== null) total = (total ?? 0) + seconds;
  }
  return total;
}

/** Why a question came back, in the reader's words, and where else an edit to it would land. */
function CardNotice({
  work,
  question,
}: Readonly<{ work: SectionWork; question: SectionQuestion }>) {
  const { review } = question;
  const fixed = review.state === REVIEW_STATES.FIXED;
  const sentBack = Boolean(review.reason) && (fixed || review.state === REVIEW_STATES.SENT_BACK);
  const warnsOfOtherTests = question.editable && work.seat !== SECTION_SEATS.TYPIST;
  if (!sentBack && !warnsOfOtherTests) return null;
  const reason = review.reason ? SEND_BACK_REASON_LABELS[review.reason] : '';
  const said = [`${fixed ? 'Fixed after being sent back' : 'Sent back'}: ${reason}.`, review.note];
  return (
    <div className="flex flex-col gap-2 px-4 pt-3">
      {sentBack ? (
        <Alert variant={fixed ? 'info' : 'warning'}>{said.filter(Boolean).join(' ')}</Alert>
      ) : null}
      {warnsOfOtherTests ? (
        <OtherTestsNotice
          questionId={question.questionId}
          read={() =>
            api.admin.sectionWork.otherTests(
              work.testId,
              work.baseConfigSectionId,
              question.questionId,
            )
          }
        />
      ) : null}
    </div>
  );
}

/** What can be done to this one question, on its own card: check it, send it back, mark it fixed. */
function CardActions({
  work,
  question,
  seat,
  onChanged,
  onSettle,
}: Readonly<{
  work: SectionWork;
  question: SectionQuestion;
  seat: ReturnType<typeof seatOf>;
  onChanged: (next: SectionWork) => void;
  onSettle: (savedId?: string) => Promise<void>;
}>) {
  const [sending, setSending] = useState(false);
  const { testId, baseConfigSectionId: sectionId } = work;
  const id = question.questionId;
  const state = question.review.state;

  const review = useMutation({
    mutationFn: (act: 'check' | 'uncheck' | 'fixed') => {
      if (act === 'check') return api.admin.sectionWork.check(testId, sectionId, id);
      if (act === 'uncheck') return api.admin.sectionWork.uncheck(testId, sectionId, id);
      return api.admin.sectionWork.fixed(testId, sectionId, id);
    },
    onSuccess: onChanged,
  });

  if (seat.reading) {
    if (state === REVIEW_STATES.SENT_BACK) return <Badge variant="warning">With the typist</Badge>;
    const checked = state === REVIEW_STATES.CHECKED;
    return (
      <>
        <Button
          type="button"
          size="sm"
          variant={checked ? 'default' : 'outline'}
          aria-pressed={checked}
          loading={review.isPending}
          onClick={() => review.mutate(checked ? 'uncheck' : 'check')}
        >
          <CheckCheck aria-hidden />
          {checked ? 'Checked' : 'Check'}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={() => setSending(true)}>
          Send back
        </Button>
        {sending ? (
          <SendBackDialog
            work={work}
            question={question}
            onClose={() => setSending(false)}
            onSent={onChanged}
          />
        ) : null}
      </>
    );
  }
  if (seat.fixing && state === REVIEW_STATES.SENT_BACK) {
    return (
      <Button
        type="button"
        size="sm"
        loading={review.isPending}
        onClick={() => review.mutate('fixed')}
      >
        Mark fixed
      </Button>
    );
  }
  if (question.deletable) {
    return <DeleteQuestion work={work} question={question} onSettle={onSettle} />;
  }
  return null;
}

/** A typist's own mistake, taken back while it is still off the paper. */
function DeleteQuestion({
  work,
  question,
  onSettle,
}: Readonly<{
  work: SectionWork;
  question: SectionQuestion;
  onSettle: (savedId?: string) => Promise<void>;
}>) {
  const named = question.preview ? `“${question.preview}”` : 'This question';
  // No id: the deleted question's own read sits under this section, and refetching it would 404.
  const deleting = useDeleteQuestion({
    consequence: `${named} is removed for good.`,
    remove: () =>
      api.admin.sectionWork.remove(work.testId, work.baseConfigSectionId, question.questionId),
    onDeleted: () => onSettle(),
  });

  return (
    <>
      <Button type="button" size="sm" variant="outline" onClick={deleting.ask}>
        <Trash2 aria-hidden />
        Delete
      </Button>
      <ConfirmDialog {...deleting.confirm} />
    </>
  );
}

/** One question back to its typist, with the reason and what to change. */
function SendBackDialog({
  work,
  question,
  onClose,
  onSent,
}: Readonly<{
  work: SectionWork;
  question: SectionQuestion;
  onClose: () => void;
  onSent: (next: SectionWork) => void;
}>) {
  const [reason, setReason] = useState<SendBackReason | ''>('');
  const [note, setNote] = useState('');
  const send = useMutation({
    meta: { success: 'Sent back to the typist.' },
    mutationFn: (chosen: SendBackReason) =>
      api.admin.sectionWork.sendBack(work.testId, work.baseConfigSectionId, question.questionId, {
        reason: chosen,
        note: note.trim() || undefined,
      }),
    onSuccess: (next) => {
      onSent(next);
      onClose();
    },
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Send back to the typist</DialogTitle>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          <RadioGroup
            name={`send-back-${question.questionId}`}
            legend="Reason"
            value={reason}
            onValueChange={(next) => setReason(next as SendBackReason)}
            className="grid gap-2"
          >
            {REASON_ORDER.map((one) => (
              <RadioGroupItem
                key={one}
                id={`send-back-${question.questionId}-${one}`}
                value={one}
                label={SEND_BACK_REASON_LABELS[one]}
              />
            ))}
          </RadioGroup>
          <Textarea
            aria-label="What to change"
            placeholder="What to change (optional)"
            value={note}
            maxLength={500}
            onChange={(event) => setNote(event.target.value)}
          />
        </DialogBody>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">
              Cancel
            </Button>
          </DialogClose>
          <Button
            type="button"
            disabled={reason === ''}
            loading={send.isPending}
            onClick={() => reason && send.mutate(reason)}
          >
            Send back
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The section's progress, one tab per role: who holds it, what is pending, and a tile per question. */
function ProgressPanel({
  work,
  activeKey,
  jump,
}: Readonly<{ work: SectionWork; activeKey: string; jump: (key: string) => void }>) {
  const seat = seatOf(work);
  const counts = countsOf(work);
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
        <TimeStat seconds={seatTime(work, 'typist')} />
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
        <TimeStat seconds={seatTime(work, 'reader')} />
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
