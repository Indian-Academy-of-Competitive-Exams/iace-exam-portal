import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, Flag, X } from 'lucide-react';
import {
  LANGUAGE_LABELS,
  QUESTION_FLAG_CATEGORIES,
  QUESTION_FLAG_STATUS,
  createQuestionFlagSchema,
  type CreateQuestionFlagInput,
  type ProofreadQuestion,
  type QuestionFlag as Flagged,
  type QuestionFlagSettlement,
} from '@iace/contracts';
import { applyFieldErrors } from '@iace/app-kit';
import {
  Badge,
  Button,
  Combobox,
  ConfirmDialog,
  DropdownMenuItem,
  FormDialog,
  FormField,
  RowActions,
  Textarea,
} from '@iace/ui';
import { api } from '../lib/api';
import { WHEN_FORMATTER } from '../lib/audit-vocabulary';
import {
  DIFFICULTY_VARIANT,
  QUESTION_FLAG_CATEGORY_LABELS,
  QUESTION_FLAG_STATUS_LABELS,
  QUESTION_FLAG_STATUS_VARIANT,
  QUESTION_STATUS_LABELS,
  QUESTION_STATUS_VARIANT,
  QUERY_KEYS,
} from '../lib/constants';
import { QuestionInLanguage } from './question-body';

/** One question in the proof-reading document: every language it was written in, then its flags. */

export function ProofreadQuestionBlock({
  question,
  index,
  canWrite,
}: Readonly<{ question: ProofreadQuestion; index: number; canWrite: boolean }>) {
  const [flagging, setFlagging] = useState(false);

  return (
    <article
      data-print-block
      className="flex flex-col gap-5 border-b border-border pb-8 last:border-b-0"
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className="text-md font-semibold tracking-tight text-foreground">
            {`${index}. ${question.questionCode ?? question.subject.name}`}
          </h2>
          <p className="text-sm text-muted-foreground">
            {[question.subject.name, question.topic?.name, `Version ${question.version}`]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Badge variant={QUESTION_STATUS_VARIANT[question.status]}>
            {QUESTION_STATUS_LABELS[question.status]}
          </Badge>
          <Badge variant={DIFFICULTY_VARIANT[question.difficulty]}>{question.difficulty}</Badge>
          {canWrite ? (
            <span data-print-hide>
              <Button size="sm" variant="outline" onClick={() => setFlagging(true)}>
                <Flag aria-hidden />
                Flag
              </Button>
            </span>
          ) : null}
        </div>
      </header>

      {question.languages.map((language) => (
        <section key={language} className="flex flex-col gap-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {LANGUAGE_LABELS[language]}
          </h3>
          <QuestionInLanguage question={question} language={language} />
        </section>
      ))}

      <FlagList flags={question.flags} canWrite={canWrite} />

      {flagging ? (
        <RaiseFlagDialog
          questionId={question.id}
          open
          onOpenChange={setFlagging}
          onDone={() => setFlagging(false)}
        />
      ) : null}
    </article>
  );
}

function FlagList({ flags, canWrite }: Readonly<{ flags: readonly Flagged[]; canWrite: boolean }>) {
  if (flags.length === 0) return null;

  return (
    <ul className="flex flex-col gap-3 border-l-2 border-border pl-4">
      {flags.map((flag) => (
        <li key={flag.id} className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={QUESTION_FLAG_STATUS_VARIANT[flag.status]}>
                {QUESTION_FLAG_STATUS_LABELS[flag.status]}
              </Badge>
              <span className="text-sm font-medium text-foreground">
                {QUESTION_FLAG_CATEGORY_LABELS[flag.category]}
              </span>
              {flag.onCurrentVersion ? null : (
                <Badge variant="neutral">Raised on an earlier version</Badge>
              )}
            </div>
            <p className="whitespace-pre-wrap text-sm text-foreground">{flag.comment}</p>
            <p className="text-xs text-muted-foreground">
              {`${flag.raisedBy?.name ?? 'Someone'} · ${WHEN_FORMATTER.format(new Date(flag.createdAt))}`}
            </p>
          </div>

          {canWrite && flag.status === QUESTION_FLAG_STATUS.OPEN ? (
            <span data-print-hide>
              <SettleFlag flag={flag} />
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/** Settling the last open flag is what lets the question be approved, so both answers confirm. */
const SETTLEMENTS = {
  RESOLVED: {
    title: 'Resolve this flag?',
    description:
      'It stops blocking the question. Once no flag on it is open, an author can approve it into the bank as ACTIVE.',
    confirmLabel: 'Resolve it',
    success: 'Flag resolved.',
  },
  DISMISSED: {
    title: 'Dismiss this flag?',
    description:
      'The objection is recorded as not upheld and stops blocking the question. Once no flag on it is open, an author can approve it into the bank as ACTIVE.',
    confirmLabel: 'Dismiss it',
    success: 'Flag dismissed.',
  },
} as const satisfies Record<QuestionFlagSettlement, unknown>;

function SettleFlag({ flag }: Readonly<{ flag: Flagged }>) {
  const [asking, setAsking] = useState<QuestionFlagSettlement | null>(null);
  const queryClient = useQueryClient();
  const prompt = asking ? SETTLEMENTS[asking] : null;

  const settle = useMutation({
    meta: { success: prompt?.success },
    mutationFn: (status: QuestionFlagSettlement) =>
      api.admin.proofreading.settle(flag.id, { status }),
    onSuccess: async () => {
      setAsking(null);
      await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.PROOFREADING });
    },
    onError: () => setAsking(null),
  });

  return (
    <>
      <RowActions label={`Settle the ${QUESTION_FLAG_CATEGORY_LABELS[flag.category]} flag`}>
        <DropdownMenuItem
          disabled={settle.isPending}
          onSelect={() => setAsking(QUESTION_FLAG_STATUS.RESOLVED)}
        >
          <Check aria-hidden />
          Resolve
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={settle.isPending}
          onSelect={() => setAsking(QUESTION_FLAG_STATUS.DISMISSED)}
        >
          <X aria-hidden />
          Dismiss
        </DropdownMenuItem>
      </RowActions>

      {prompt && asking ? (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setAsking(null)}
          loading={settle.isPending}
          title={prompt.title}
          description={prompt.description}
          confirmLabel={prompt.confirmLabel}
          onConfirm={() => settle.mutate(asking)}
        />
      ) : null}
    </>
  );
}

function RaiseFlagDialog({
  questionId,
  open,
  onOpenChange,
  onDone,
}: Readonly<{
  questionId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}>) {
  const queryClient = useQueryClient();
  const form = useForm<CreateQuestionFlagInput>({
    resolver: zodResolver(createQuestionFlagSchema),
    defaultValues: { category: 'AWKWARD', comment: '' },
  });

  const raise = useMutation({
    meta: { success: 'Flag raised.' },
    mutationFn: (input: CreateQuestionFlagInput) => api.admin.proofreading.raise(questionId, input),
    onSuccess: async () => {
      onDone();
      await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.PROOFREADING });
    },
    onError: (error) => applyFieldErrors(error, form.setError, ['category', 'comment']),
  });

  const category = useWatch({ control: form.control, name: 'category' });

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      form={form}
      onSubmit={(values) => raise.mutate(values)}
      title="New flag"
      /* ui-copy-ok: consequence */
      description="An open flag stops the question going active until it is resolved or dismissed."
      submitLabel="Raise the flag"
      loading={raise.isPending}
    >
      <FormField form={form} name="category" label="Category">
        {(control) => (
          <Combobox
            id={control.id}
            aria-describedby={control['aria-describedby']}
            aria-invalid={control['aria-invalid']}
            clearable={false}
            value={category}
            onChange={(next) =>
              form.setValue('category', next as CreateQuestionFlagInput['category'], {
                shouldDirty: true,
              })
            }
            items={QUESTION_FLAG_CATEGORIES.map((value) => ({
              value,
              label: QUESTION_FLAG_CATEGORY_LABELS[value],
            }))}
          />
        )}
      </FormField>

      <FormField form={form} name="comment" label="Comment">
        {(control) => <Textarea {...control} rows={4} autoFocus />}
      </FormField>
    </FormDialog>
  );
}
