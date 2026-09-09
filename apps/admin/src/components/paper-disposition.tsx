import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  DISPOSITION_REASON_MAX,
  PAPER_QUESTION_STATUS,
  type PaperQuestionStatus,
  type PaperRow,
  type TestPaper,
} from '@iace/contracts';
import {
  Badge,
  ConfirmDialog,
  DropdownMenuItem,
  Field,
  RowActions,
  Textarea,
  plural,
  type BadgeProps,
} from '@iace/ui';
import { api } from '../lib/api';

/** What a finalized paper's question is worth now — the only change a frozen paper allows. */

/** ACTIVE is what every row is unless something says otherwise, so only the exceptions are badged. */
const DISPOSITION_BADGE: Readonly<
  Record<PaperQuestionStatus, { label: string; variant: BadgeProps['variant'] } | null>
> = {
  [PAPER_QUESTION_STATUS.ACTIVE]: null,
  [PAPER_QUESTION_STATUS.DROPPED]: { label: 'Dropped', variant: 'danger' },
  [PAPER_QUESTION_STATUS.BONUS]: { label: 'Bonus', variant: 'info' },
};

const DISPOSITION_ACTION: Readonly<Record<PaperQuestionStatus, string>> = {
  [PAPER_QUESTION_STATUS.ACTIVE]: 'Return to scoring',
  [PAPER_QUESTION_STATUS.DROPPED]: 'Drop from scoring',
  [PAPER_QUESTION_STATUS.BONUS]: 'Make a bonus',
};

const DISPOSITION_TITLE: Readonly<Record<PaperQuestionStatus, (order: number) => string>> = {
  [PAPER_QUESTION_STATUS.ACTIVE]: (order) => `Return question ${order} to scoring?`,
  [PAPER_QUESTION_STATUS.DROPPED]: (order) => `Drop question ${order} from scoring?`,
  [PAPER_QUESTION_STATUS.BONUS]: (order) => `Make question ${order} a bonus?`,
};

/** `docs/02-domain-rules.md` §4 in the reader's words: what each disposition pays, and to whom. */
const DISPOSITION_PAYS: Readonly<Record<PaperQuestionStatus, string>> = {
  [PAPER_QUESTION_STATUS.ACTIVE]:
    'The answer key judges it again, taking back whatever the drop or the bonus paid.',
  [PAPER_QUESTION_STATUS.DROPPED]:
    'Its marks go to everyone who attempted it and the negative is taken back; a student who left it alone gets zero.',
  [PAPER_QUESTION_STATUS.BONUS]: 'Its marks go to the whole cohort, attempted or not.',
};

/** Drop first: it is the one faculty reach for. Returning to scoring undoes either of the others. */
const DISPOSITION_ORDER = [
  PAPER_QUESTION_STATUS.DROPPED,
  PAPER_QUESTION_STATUS.BONUS,
  PAPER_QUESTION_STATUS.ACTIVE,
] as const;

export function DispositionBadge({ status }: Readonly<{ status: PaperQuestionStatus }>) {
  const badge = DISPOSITION_BADGE[status];
  if (!badge) return null;
  return <Badge variant={badge.variant}>{badge.label}</Badge>;
}

/** `attemptCount` is every sitting on the test, so it is the ceiling on what re-scores, not the count. */
function consequenceOf(
  status: PaperQuestionStatus,
  attemptCount: number,
  variantCount: number,
): string {
  const spread = variantCount > 1 ? ` It moves on all ${plural(variantCount, 'paper')}.` : '';
  const rescore =
    attemptCount === 0
      ? ' Nobody has sat this test yet, so there is nothing to score again.'
      : ` Every one of the ${plural(attemptCount, 'sitting')} sat so far that served it is scored again and the standings are rebuilt, so scores, ranks and percentiles will change.`;
  return `${DISPOSITION_PAYS[status]}${spread}${rescore}`;
}

export function PaperDisposition({
  testId,
  row,
  attemptCount,
  variantCount,
  onChanged,
  onRescoring,
}: Readonly<{
  testId: string;
  row: PaperRow;
  /** Every sitting on the test, for the confirm to name what it is about to move. */
  attemptCount: number;
  variantCount: number;
  onChanged: (next: TestPaper) => Promise<void>;
  /** Raised only where sittings exist to re-score, so the screen never claims work nobody queued. */
  onRescoring: () => void;
}>) {
  const [pending, setPending] = useState<PaperQuestionStatus | null>(null);
  const [reason, setReason] = useState('');
  const [missing, setMissing] = useState(false);

  const close = () => {
    setPending(null);
    setReason('');
    setMissing(false);
  };

  const set = useMutation({
    meta: {
      success: attemptCount > 0 ? 'Saved. Re-scoring runs in the background.' : 'Saved.',
    },
    mutationFn: (status: PaperQuestionStatus) =>
      api.admin.tests.setPaperQuestionStatus(testId, row.id, { status, reason }),
    onSuccess: async (next) => {
      close();
      if (attemptCount > 0) onRescoring();
      await onChanged(next);
    },
  });

  const reasonId = `disposition-reason-${row.id}`;

  return (
    <>
      <RowActions label={`Question ${row.order} actions`}>
        {DISPOSITION_ORDER.filter((status) => status !== row.status).map((status) => (
          <DropdownMenuItem
            key={status}
            destructive={status === PAPER_QUESTION_STATUS.DROPPED}
            onSelect={() => setPending(status)}
          >
            {DISPOSITION_ACTION[status]}
          </DropdownMenuItem>
        ))}
      </RowActions>

      {pending ? (
        <ConfirmDialog
          open
          onOpenChange={(open) => {
            if (!open) close();
          }}
          destructive
          title={DISPOSITION_TITLE[pending](row.order)}
          description={consequenceOf(pending, attemptCount, variantCount)}
          confirmLabel={DISPOSITION_ACTION[pending]}
          loading={set.isPending}
          onConfirm={() => (reason.trim() === '' ? setMissing(true) : set.mutate(pending))}
        >
          <Field
            htmlFor={reasonId}
            label="Reason"
            // ui-copy-ok: consequence — the audit trail keeps it, which the field cannot show
            hint="Kept on the audit trail"
            error={missing ? 'Say why this question is changing' : undefined}
          >
            {(control) => (
              <Textarea
                {...control}
                value={reason}
                maxLength={DISPOSITION_REASON_MAX}
                onChange={(event) => {
                  setReason(event.target.value);
                  setMissing(false);
                }}
              />
            )}
          </Field>
        </ConfirmDialog>
      ) : null}
    </>
  );
}
