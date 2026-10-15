import { useState, useSyncExternalStore } from 'react';
import { useMutation } from '@tanstack/react-query';
import { CheckCheck, Trash2 } from 'lucide-react';
import {
  PAPER_SOURCES,
  REVIEW_STATES,
  SECTION_SEATS,
  SEND_BACK_REASONS,
  type QuestionTime,
  type SectionQuestion,
  type SectionWork,
  type SendBackReason,
} from '@iace/contracts';
import {
  Button,
  Badge,
  ConfirmDialog,
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  RadioGroup,
  RadioGroupItem,
  Textarea,
} from '@iace/ui';
import { api } from '../../lib/api';
import { SEND_BACK_REASON_LABELS } from '../../lib/labels';
import { useDeleteQuestion } from './use-delete-question';
import { OtherTestsNotice } from './cross-test-warning';
import { NoticeChip } from './notice-chip';
import { TimeSpent } from '../../components/time-spent';
import type { WorkClock } from './work-clock';
import type { Seat } from './section-seat';

const REASON_ORDER = [
  SEND_BACK_REASONS.SPELLING,
  SEND_BACK_REASONS.DATA_CORRECTION,
  SEND_BACK_REASONS.ANSWER_OPTION,
] as const;

/** The viewer's own time on one question, running while it is the one on screen. */
export function OwnClock({
  clock,
  id,
  held,
}: Readonly<{ clock: WorkClock; id: string; held: number }>) {
  const seconds = useSyncExternalStore(clock.subscribe, () => clock.shown(id, held));
  return <TimeSpent seconds={seconds} label="Time on this question" />;
}

/** Each seat's time on the question, for the owner and a super admin, who are sent both. */
export function SeatTimes({ time }: Readonly<{ time: QuestionTime }>) {
  if (time.typist === null || time.reader === null) return null;
  return (
    <>
      <TimeSpent seat="Typist" seconds={time.typist} />
      <TimeSpent seat="Proof-reader" seconds={time.reader} />
    </>
  );
}

/** Why a question came back, in the reader's words, and where else an edit to it would land. */
export function CardNotice({
  work,
  question,
}: Readonly<{ work: SectionWork; question: SectionQuestion }>) {
  const { review } = question;
  const fixed = review.state === REVIEW_STATES.FIXED;
  const sentBack = Boolean(review.reason) && (fixed || review.state === REVIEW_STATES.SENT_BACK);
  // A framed paper's typist writes questions no other test holds yet; a picked paper's fixes the bank's own.
  const shared = work.seat !== SECTION_SEATS.TYPIST || work.paperSource === PAPER_SOURCES.PICKED;
  const warnsOfOtherTests = question.editable && shared;
  if (!sentBack && !warnsOfOtherTests) return null;
  const reason = review.reason ? SEND_BACK_REASON_LABELS[review.reason] : '';
  const said = [`${fixed ? 'Fixed after being sent back' : 'Sent back'}: ${reason}.`, review.note];
  return (
    <>
      {sentBack ? (
        <NoticeChip
          tone={fixed ? 'info' : 'warning'}
          label={fixed ? 'Fixed after being sent back' : 'Sent back'}
        >
          {said.filter(Boolean).join(' ')}
        </NoticeChip>
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
    </>
  );
}

/** What can be done to this one question, on its own card: check it, send it back, mark it fixed. */
export function CardActions({
  work,
  question,
  seat,
  fixable,
  onChanged,
  onSettle,
}: Readonly<{
  work: SectionWork;
  question: SectionQuestion;
  seat: Seat;
  /** Sent back to the viewer, with no unsaved edit that marking it fixed would leave behind. */
  fixable: boolean;
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
        {/* Left out with nobody to take it: the server refuses a send-back on a section with no typist. */}
        {work.typist ? (
          <Button type="button" size="sm" variant="outline" onClick={() => setSending(true)}>
            Send back
          </Button>
        ) : null}
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
  if (fixable) {
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
  if (question.deletable && seat.writes) {
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
