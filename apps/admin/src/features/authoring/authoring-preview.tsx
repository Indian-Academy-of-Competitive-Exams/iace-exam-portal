import { useState } from 'react';
import { Check, ChevronUp, CircleAlert, CircleDot, Circle, TriangleAlert } from 'lucide-react';
import { QUESTION_TYPE, hasText, previewTextOf, type QuestionLanguage } from '@iace/contracts';
import { Badge, RichContent, cn } from '@iace/ui';
import { answerIndexOf, optionLetter, type AuthoringState } from './question-scaffold';

/** One rule, and how the question stands against it. */
export interface Check {
  key: string;
  label: string;
  state: 'pass' | 'warn' | 'fail';
  meta?: string;
}

export function AuthoringPreview({
  state,
  language,
}: Readonly<{ state: AuthoringState; language: QuestionLanguage }>) {
  const content = state.content[language];
  const correct = answerIndexOf(state.answer, state.optionCount);
  const isMcq = state.type === QUESTION_TYPE.SINGLE_MCQ;

  return (
    <section className="flex flex-col gap-4 rounded-md border border-border bg-surface p-5">
      {state.type !== QUESTION_TYPE.TYPING && hasText(content.passage) ? (
        <RichContent
          html={content.passage}
          lang={language}
          className="border-b border-border pb-4"
        />
      ) : null}
      <RichContent html={content.stem} lang={language} />

      {isMcq ? (
        <ol className="flex flex-col gap-2">
          {content.options.map((option, index) => (
            <li
              key={optionLetter(index)}
              className={cn(
                'flex items-center gap-3 rounded-md border px-3 py-2 text-sm',
                index === correct ? 'border-success bg-success-subtle' : 'border-border',
              )}
            >
              <span className="w-4 text-xs tabular-nums text-muted-foreground">
                {optionLetter(index)}
              </span>
              {index === correct ? (
                <CircleDot className="size-4 shrink-0 text-success-ink" aria-hidden />
              ) : (
                <Circle className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              )}
              <RichContent html={option} lang={language} className="min-w-0 flex-1" />
              {index === correct ? <span className="sr-only">Correct</span> : null}
            </li>
          ))}
        </ol>
      ) : null}
      {state.type === QUESTION_TYPE.TEXT_FIELD ? (
        <p className="border-l-2 border-border pl-3 text-sm">
          <span className="font-semibold">Answer. </span>
          {previewTextOf(state.answer) || '—'}
        </p>
      ) : null}

      {content.solution ? (
        <div className="flex gap-2 border-l-2 border-border pl-3 text-sm">
          <span className="shrink-0 font-semibold">Explanation.</span>
          <RichContent html={content.solution} lang={language} />
        </div>
      ) : null}
    </section>
  );
}

const ICON = {
  pass: Check,
  warn: TriangleAlert,
  fail: CircleAlert,
} as const;

const TONE = {
  pass: 'text-success',
  warn: 'text-warning',
  fail: 'text-destructive',
} as const;

/** Colour alone does not say which rows stop a save, so the row that does says it in a word. */
const STANDING = {
  pass: null,
  warn: { label: 'Optional', variant: 'warning' },
  fail: { label: 'Required', variant: 'danger' },
} as const;

/** The list in a badge per standing, so the closed footer still says whether the question can be saved. */
export function ChecksStatus({ checks }: Readonly<{ checks: readonly Check[] }>) {
  const failing = checks.filter((check) => check.state === 'fail').length;
  const warning = checks.filter((check) => check.state === 'warn').length;
  if (failing === 0 && warning === 0) return <Badge variant="success">All clear</Badge>;
  return (
    <>
      {failing > 0 ? <Badge variant="danger">{`${failing} required`}</Badge> : null}
      {warning > 0 ? <Badge variant="warning">{`${warning} optional`}</Badge> : null}
    </>
  );
}

export function ChecksList({ checks }: Readonly<{ checks: readonly Check[] }>) {
  return (
    <ul className="flex flex-col gap-2.5">
      {checks.map((check) => {
        const Icon = ICON[check.state];
        const standing = STANDING[check.state];
        return (
          <li key={check.key} className="flex items-center gap-3 text-sm">
            <Icon className={cn('size-4 shrink-0', TONE[check.state])} aria-hidden />
            <span className="min-w-0 flex-1">{check.label}</span>
            {standing ? (
              <Badge variant={standing.variant} className="shrink-0">
                {standing.label}
              </Badge>
            ) : null}
            {check.meta ? (
              <span className="shrink-0 text-xs text-muted-foreground">{check.meta}</span>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

/** The foot of the preview pane: badges say whether it can be saved, and the list unfolds upward. */
export function ValidationFooter({ checks }: Readonly<{ checks: readonly Check[] }>) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-none flex-col border-t border-border bg-surface">
      {open ? (
        <div
          id={VALIDATION_PANEL}
          className="relative max-h-64 overflow-y-auto border-b border-border px-4 py-3"
        >
          <ChecksList checks={checks} />
        </div>
      ) : null}
      <button
        type="button"
        aria-expanded={open}
        aria-controls={VALIDATION_PANEL}
        onClick={() => setOpen((was) => !was)}
        className="flex min-h-10 items-center gap-2 px-4 text-sm font-semibold hover:bg-muted focus-visible:shadow-focus focus-visible:outline-none"
      >
        <ChevronUp
          className={cn('size-4 text-muted-foreground transition-transform', open && 'rotate-180')}
          aria-hidden
        />
        <span className="flex-1 text-left">Validation</span>
        <ChecksStatus checks={checks} />
      </button>
    </div>
  );
}

const VALIDATION_PANEL = 'authoring-validation';
