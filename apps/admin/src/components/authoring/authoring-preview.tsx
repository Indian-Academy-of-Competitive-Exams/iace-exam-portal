import { Check, CircleAlert, CircleDot, Circle, TriangleAlert } from 'lucide-react';
import { QUESTION_TYPE, previewTextOf, type QuestionLanguage } from '@iace/contracts';
import { RichContent, cn } from '@iace/ui';
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
    <section className="rounded-md border border-border bg-surface p-5">
      <RichContent html={content.stem} lang={language} />

      {isMcq ? (
        <ol className="mt-4 space-y-2">
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
              {index === correct ? (
                <span className="shrink-0 text-xs font-medium text-success-ink">Correct</span>
              ) : null}
            </li>
          ))}
        </ol>
      ) : (
        <p className="mt-4 border-l-2 border-border pl-3 text-sm">
          <span className="font-semibold">Answer. </span>
          {previewTextOf(state.answer) || '—'}
        </p>
      )}

      {content.solution ? (
        <div className="mt-4 flex gap-2 border-l-2 border-border pl-3 text-sm">
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

export function AuthoringChecks({ checks }: Readonly<{ checks: readonly Check[] }>) {
  return (
    <section className="rounded-md border border-border bg-surface">
      <h2 className="border-b border-border px-5 py-3 text-sm font-semibold">Validation</h2>
      <ul>
        {checks.map((check) => {
          const Icon = ICON[check.state];
          return (
            <li
              key={check.key}
              className="flex items-center gap-3 border-b border-border px-5 py-2.5 text-sm last:border-b-0"
            >
              <Icon className={cn('size-4 shrink-0', TONE[check.state])} aria-hidden />
              <span className="min-w-0 flex-1">{check.label}</span>
              {check.meta ? (
                <span className="shrink-0 text-xs text-muted-foreground">{check.meta}</span>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
