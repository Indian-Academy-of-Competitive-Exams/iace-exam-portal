import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCheck, Info, Send } from 'lucide-react';
import {
  AppException,
  DIFFICULTY_LEVEL,
  ErrorCodes,
  REVIEW_STATES,
  SECTION_SEATS,
  instituteDayLabel,
  type ReviewState,
  type SectionQuestion,
  type SectionWork,
  SECTION_QUESTION_TYPES,
} from '@iace/contracts';
import {
  Badge,
  Button,
  EmptyState,
  EMPTY_STATE_KINDS,
  LoadingState,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TruncatedText,
  type BadgeProps,
  toast,
} from '@iace/ui';
import { api } from '../../lib/api';
import { QUERY_KEYS, sectionWorkHeldQueryKey, sectionWorkQueryKey } from '../../lib/query-keys';
import { REVIEW_STATE_LABELS } from '../../lib/labels';
import { SECTION_QUESTION_PARAM } from '../../lib/constants';
import { useAuth } from '../../providers/auth';
import { SectionThreadButton } from '../../components/section-thread';
import { TypistDoneDialog } from './typist-done-dialog';
import { AuthoringWorkspace } from './authoring-workspace';
import { NEW_CARD, type Held, type WorkspaceCard, type WorkspaceSource } from './workspace-types';
import { headerOf, stateOf, toDraft } from './question-scaffold';
import { FinalizeAssignmentDialog } from './finalize-assignment-dialog';
import { useWorkClock } from './use-work-clock';
import { DueStandingBadge } from '../../components/due-standing-badge';
import { TimeSpent } from '../../components/time-spent';
import { awaitsViewer, type WorkClock } from './work-clock';
import { seatOf, type Seat } from './section-seat';
import { OwnClock, SeatTimes, CardNotice, CardActions } from './section-question-card';
import { ProgressPanel } from './section-progress-panel';

const REVIEW_BADGE: Record<ReviewState, BadgeProps['variant']> = {
  [REVIEW_STATES.UNCHECKED]: 'neutral',
  [REVIEW_STATES.CHECKED]: 'success',
  [REVIEW_STATES.SENT_BACK]: 'warning',
  [REVIEW_STATES.FIXED]: 'info',
};

/** How often a blocked screen asks whether the claim on its section has been given up. */
const CLAIM_POLL_MS = 10_000;

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
  // Only a failed first read takes the page: a failed re-read keeps the cards and what is typed into them.
  if (!work.data) {
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
  const { identity, can } = useAuth();
  const seat = useMemo(() => seatOf(work, can), [work, can]);
  const elsewhere = editingElsewhere(work, identity?.id);
  // A super admin's save takes the claim over, so they are told and never stopped.
  const blocked = elsewhere !== null && !identity?.isSuperAdmin;
  const [finishing, setFinishing] = useState(false);
  const [releasing, setReleasing] = useState(false);
  const { testId, baseConfigSectionId: sectionId } = work;

  // Time is counted for whoever holds a seat, while the paper can still change.
  const seated = seat.writes && !work.seatReplaced && work.seat !== SECTION_SEATS.OWNER;
  const counting = seated && !work.offered;
  const [inView, setInView] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [unsaved, setUnsaved] = useState(0);
  // Nothing is handed on over an unsaved edit: the hand-on closes the card, and the edit is left behind.
  const pending = unsaved > 0;
  // A saved question's clock stands still: only a blank card, one being edited, or one waiting on the viewer counts.
  const owed =
    inView === NEW_CARD ||
    editing ||
    work.questions.some(
      (question) => question.questionId === inView && awaitsViewer(seat, question.review.state),
    );
  const clock = useWorkClock(testId, sectionId, counting && owed ? inView : null);
  const rest = useCallback((key: string | null, dirty: boolean) => {
    setInView(key);
    setEditing(dirty);
  }, []);

  const source = useMemo((): WorkspaceSource => {
    return {
      cards: work.questions.map((question, index) =>
        cardOf(
          work,
          question,
          index,
          { seat, clock: counting ? clock : null, pending },
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
        try {
          // Refused if it moved since this card read it: an edit made elsewhere is not overwritten.
          await api.admin.sectionWork.edit(testId, sectionId, id, {
            ...toDraft(held.state, held.header),
            expectedUpdatedAt: held.stamp,
          });
        } catch (error) {
          // A refusal may name a claim taken since the section was read: read again, the page says who holds it.
          void onSettle();
          throw error;
        }
        await onSettle(id);
      },
      subjectLocked: work.sectionSubjectId !== null,
      types: SECTION_QUESTION_TYPES[work.answerKind],
      blocked,
      checkDuplicates: seat.typing,
      languages: work.languages,
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
  }, [work, seat, blocked, counting, clock, pending, testId, sectionId, onChanged, onSettle]);

  const extra = (
    <>
      {seat.typing && !pending ? (
        <Button type="button" size="sm" variant="outline" onClick={() => setFinishing(true)}>
          <CheckCheck aria-hidden />
          Mark done
        </Button>
      ) : null}
      {seat.releasing && !pending ? (
        <Button type="button" size="sm" variant="outline" onClick={() => setReleasing(true)}>
          <Send aria-hidden />
          Release
        </Button>
      ) : null}
    </>
  );

  const title = <SectionTitle work={work} elsewhere={elsewhere} blocked={blocked} />;
  const empty = source.cards.length === 0 && !source.create;
  // The thread takes its section's seats and a super admin, who holds none here.
  const thread = (
    <SectionThreadButton
      testId={testId}
      sectionId={sectionId}
      canWrite={!work.sat && (seated || Boolean(identity?.isSuperAdmin))}
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
          onActive={onActive}
          onResting={rest}
          onUnsavedChange={setUnsaved}
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
            render: (position) => (
              <ProgressPanel
                work={work}
                seat={seat}
                clock={counting ? clock : null}
                {...position}
              />
            ),
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

/** Where the section stands, said once as a toast when it changes, so it takes no room from the editor. */
function SectionState({ work }: Readonly<{ work: SectionWork }>) {
  const state = contextOf(work);
  const text = state?.text;
  const success = state?.variant === 'success';
  useEffect(() => {
    if (!text) return;
    if (success) toast.success(text);
    else toast.info(text);
  }, [text, success]);
  return null;
}

/** Who else holds this section right now, by name; nobody when it is free or the viewer's own. */
function editingElsewhere(work: SectionWork | undefined, viewerId: string | undefined) {
  const editingBy = work?.editingBy;
  if (!editingBy || editingBy.adminId === viewerId) return null;
  return editingBy.fullName ?? 'Another admin';
}

/** What a stood-down seat is told: the section passed to somebody else, or left the test. */
function stoodDownText(work: SectionWork): string {
  const dropped = work.history.some(
    (row) => row.id === work.seatAssignmentId && row.sectionDropped,
  );
  if (!dropped) return 'This section has passed to somebody else. You can still read it.';
  // Leaving the test's scope deletes the section's paper, so only a typist's own drafts are left to read.
  return work.questions.length === 0
    ? 'This section left the test, and its paper went with it.'
    : 'This section left the test. You can still read it.';
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
    return { variant: 'info', text: stoodDownText(work) };
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
  { seat, clock, pending }: { seat: Seat; clock: WorkClock | null; pending: boolean },
  onChanged: (next: SectionWork) => void,
  onSettle: (savedId?: string) => Promise<void>,
): WorkspaceCard {
  const { review, time } = question;
  return {
    key: question.questionId,
    editable: question.editable && seat.writes,
    lead: (
      <span className="text-sm font-semibold tabular-nums">
        {`Question ${index + 1} of ${work.questions.length}`}
      </span>
    ),
    status: (
      <>
        <Badge variant={REVIEW_BADGE[review.state]}>{REVIEW_STATE_LABELS[review.state]}</Badge>
        {clock ? <OwnClock clock={clock} id={question.questionId} held={time.own} /> : null}
        {!clock && work.seat !== SECTION_SEATS.OWNER ? <TimeSpent seconds={time.own} /> : null}
        <SeatTimes time={time} />
        <CardNotice work={work} question={question} />
      </>
    ),
    actions: (
      <CardActions
        work={work}
        question={question}
        seat={seat}
        fixable={seat.fixing && review.state === REVIEW_STATES.SENT_BACK && !pending}
        onChanged={onChanged}
        onSettle={onSettle}
      />
    ),
  };
}
