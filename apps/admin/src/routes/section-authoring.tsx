import { useCallback, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCheck, Send, Trash2, Upload } from 'lucide-react';
import {
  AppException,
  DIFFICULTY_LEVEL,
  ErrorCodes,
  REVIEW_STATES,
  SECTION_SEATS,
  SEND_BACK_REASONS,
  type Assignment,
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
  TruncatedText,
  cn,
  type BadgeProps,
} from '@iace/ui';
import { api } from '../lib/api';
import {
  QUERY_KEYS,
  QUERY_SCOPES,
  REVIEW_STATE_LABELS,
  ROUTES,
  SECTION_QUESTION_PARAM,
  SEND_BACK_REASON_LABELS,
  sectionWorkQueryKey,
} from '../lib/constants';
import { useAuth } from '../providers/auth';
import { SectionThreadButton } from '../components/section-thread';
import { OtherTestsNotice } from '../components/cross-test-warning';
import { TypistDoneDialog } from '../components/authoring/typist-done-dialog';
import {
  AuthoringWorkspace,
  NEW_CARD,
  type Held,
  type WorkspaceCard,
  type WorkspaceSource,
} from '../components/authoring/authoring-workspace';
import { headerOf, stateOf, toDraft } from '../components/authoring/question-scaffold';
import { FinalizeAssignmentDialog } from '../components/authoring/finalize-assignment-dialog';

const REVIEW_BADGE: Record<ReviewState, BadgeProps['variant']> = {
  [REVIEW_STATES.UNCHECKED]: 'neutral',
  [REVIEW_STATES.CHECKED]: 'success',
  [REVIEW_STATES.SENT_BACK]: 'warning',
  [REVIEW_STATES.FIXED]: 'info',
};

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
  const work = useQuery({
    queryKey: sectionWorkQueryKey(testId, sectionId),
    queryFn: () => api.admin.sectionWork.one(testId, sectionId),
    retry: false,
  });

  // Only the section is read again now; the queues and duplicate checks wait until they are next opened.
  const settle = useCallback(async () => {
    for (const queryKey of [QUERY_KEYS.ASSIGNMENTS, QUERY_KEYS.AUTHORING]) {
      void queryClient.invalidateQueries({ queryKey, refetchType: 'none' });
    }
    await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.PROOFREADING });
  }, [queryClient]);
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
  onSettle: () => Promise<void>;
}>) {
  const seat = useMemo(() => seatOf(work), [work]);
  const [finishing, setFinishing] = useState(false);
  const [releasing, setReleasing] = useState(false);
  const { testId, baseConfigSectionId: sectionId } = work;

  const source = useMemo((): WorkspaceSource => {
    const typist = work.typist;
    return {
      cards: work.questions.map((question, index) =>
        cardOf(work, question, index, seat, onChanged),
      ),
      query: (id) => ({
        queryKey: [...sectionWorkQueryKey(testId, sectionId), id, QUERY_SCOPES.HELD],
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
        await onSettle();
      },
      subjectLocked: work.sectionSubjectId !== null,
      checkDuplicates: seat.typing,
      create:
        seat.typing && typist
          ? {
              header: {
                subjectId: work.sectionSubjectId ?? '',
                topicId: '',
                difficulty: DIFFICULTY_LEVEL.MEDIUM,
                tags: '',
              },
              save: async (held) => {
                await api.admin.authoring.create({
                  ...toDraft(held.state, held.header),
                  assignmentId: typist.id,
                });
                await onSettle();
              },
            }
          : undefined,
    };
  }, [work, seat, testId, sectionId, onChanged, onSettle]);

  const allChecked =
    work.questions.length >= work.questionCount &&
    work.questions.every((question) => question.review.state === REVIEW_STATES.CHECKED);

  const extra = (
    <>
      {seat.typing ? (
        <Button type="button" size="sm" variant="outline" onClick={() => setFinishing(true)}>
          <CheckCheck aria-hidden />
          Mark done
        </Button>
      ) : null}
      {seat.reading && allChecked ? (
        <Button type="button" size="sm" variant="outline" onClick={() => setReleasing(true)}>
          <Send aria-hidden />
          Release
        </Button>
      ) : null}
    </>
  );

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
            <SectionTitle work={work} />
            {thread}
          </div>
          <EmptyState title={emptyTitle(work)} />
        </>
      ) : (
        <AuthoringWorkspace
          source={source}
          startAt={startAt}
          onActive={onActive}
          title={<SectionTitle work={work} />}
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
function SectionTitle({ work }: Readonly<{ work: SectionWork }>) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <TruncatedText className="text-sm font-semibold">{work.sectionName}</TruncatedText>
      <TruncatedText className="text-sm text-muted-foreground">
        {work.testTitle ?? 'Untitled test'}
      </TruncatedText>
    </span>
  );
}

/** Where the section stands, in the words each seat reads it by — only when there is something to say. */
function SectionState({ work }: Readonly<{ work: SectionWork }>) {
  const state = contextOf(work);
  const elsewhere = useEditingElsewhere(work.testId, work.baseConfigSectionId);
  if (!state && !elsewhere) return null;
  return (
    <div className="flex flex-none flex-col gap-2 border-b border-border bg-surface px-4 py-2">
      {state ? <Alert variant={state.variant}>{state.text}</Alert> : null}
      {elsewhere ? (
        <Alert variant="warning">
          {`${elsewhere} is editing this section. Their changes have to land first.`}
        </Alert>
      ) : null}
    </div>
  );
}

/** Who else is in this section right now, read once on load so the warning lands before the work. */
function useEditingElsewhere(testId: string, sectionId: string): string | null {
  const { identity } = useAuth();
  const lock = useQuery({
    queryKey: [...QUERY_KEYS.ASSIGNMENTS, 'lock', testId, sectionId],
    queryFn: () => api.admin.assignments.sectionLock(testId, sectionId),
  });
  const editingBy = lock.data?.editingBy;
  if (!editingBy || editingBy.adminId === identity?.id) return null;
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
  if (work.seatReplaced) {
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
  seat: ReturnType<typeof seatOf>,
  onChanged: (next: SectionWork) => void,
): WorkspaceCard {
  const { review } = question;
  return {
    key: question.questionId,
    editable: question.editable,
    lead: (
      <>
        <span className="text-sm font-semibold tabular-nums">
          {`Question ${index + 1} of ${work.questions.length}`}
        </span>
        <Badge variant={REVIEW_BADGE[review.state]}>{REVIEW_STATE_LABELS[review.state]}</Badge>
      </>
    ),
    actions: <CardActions work={work} question={question} seat={seat} onChanged={onChanged} />,
    notice: <CardNotice work={work} question={question} />,
  };
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
}: Readonly<{
  work: SectionWork;
  question: SectionQuestion;
  seat: ReturnType<typeof seatOf>;
  onChanged: (next: SectionWork) => void;
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
  if (seat.typing && question.order === null) {
    return <DeleteQuestion work={work} question={question} />;
  }
  return null;
}

/** Same shape the bank's own question prompts take, so both confirms read alike. */
const DELETE_PROMPT = { title: 'Delete this question?', confirmLabel: 'Delete' } as const;

/** A typist's own mistake, taken back while it is still off the paper. */
function DeleteQuestion({
  work,
  question,
}: Readonly<{ work: SectionWork; question: SectionQuestion }>) {
  const queryClient = useQueryClient();
  const [asking, setAsking] = useState(false);
  const remove = useMutation({
    meta: { success: 'Question deleted.' },
    mutationFn: () =>
      api.admin.sectionWork.remove(work.testId, work.baseConfigSectionId, question.questionId),
    onSuccess: async () => {
      await Promise.all([
        // Exact: the deleted question's own read sits under this key, and refetching it would 404.
        queryClient.invalidateQueries({
          queryKey: sectionWorkQueryKey(work.testId, work.baseConfigSectionId),
          exact: true,
        }),
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.ASSIGNMENTS }),
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.AUTHORING }),
      ]);
      setAsking(false);
    },
  });
  const named = question.preview ? `“${question.preview}”` : 'This question';

  return (
    <>
      <Button type="button" size="sm" variant="outline" onClick={() => setAsking(true)}>
        <Trash2 aria-hidden />
        Delete
      </Button>
      <ConfirmDialog
        open={asking}
        onOpenChange={setAsking}
        title={DELETE_PROMPT.title}
        description={`${named} is removed for good.`}
        confirmLabel={DELETE_PROMPT.confirmLabel}
        destructive
        loading={remove.isPending}
        onConfirm={() => remove.mutate()}
      />
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
        <Stat label="Written" value={`${counts.written} of ${work.questionCount}`} />
        <Stat label="Sent back to fix" value={counts.sentBack} />
        {seat.typing && work.typist ? (
          <Button asChild size="sm" variant="outline">
            <Link to={ROUTES.AUTHORING_IMPORT(work.typist.id)}>
              <Upload aria-hidden />
              Import sheet
            </Link>
          </Button>
        ) : null}
        {tiles}
      </TabsContent>
      <TabsContent value="reader" className="flex flex-col gap-3 pt-3">
        <Holder holder={work.reader} earlier={earlierOf(work, 'PROOFREADER')} />
        <Stat label="Checked" value={`${counts.checked} of ${work.questions.length}`} />
        <Stat label="Sent back" value={counts.sentBack} />
        <Stat label="Fixed, to check again" value={counts.fixed} />
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

function Stat({ label, value }: Readonly<{ label: string; value: string | number }>) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium tabular-nums">{value}</span>
    </div>
  );
}
