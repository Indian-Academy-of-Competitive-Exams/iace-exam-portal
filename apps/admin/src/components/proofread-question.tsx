import { LANGUAGE_LABELS, type QuestionDetail, type QuestionLanguage } from '@iace/contracts';
import { Badge } from '@iace/ui';
import {
  DIFFICULTY_VARIANT,
  QUESTION_STATUS_LABELS,
  QUESTION_STATUS_VARIANT,
} from '../lib/constants';
import { QuestionInLanguage } from './question-body';

/** One question as a proof-reader reads it: every language it was written in, in full. */

export function ProofreadQuestionBlock({
  question,
  index,
  canWrite,
  languages,
  action,
}: Readonly<{
  question: QuestionDetail;
  index: number;
  canWrite: boolean;
  /** Which of the languages it was written in to show. Reading is done one language at a time. */
  languages: readonly QuestionLanguage[];
  /** What this reader can do to the question here — the section screen hangs its Edit on it. */
  action?: React.ReactNode;
}>) {
  return (
    <article
      data-print-block
      className="flex flex-col gap-5 border-b border-border pb-8 last:border-b-0"
    >
      <header className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-2">
          <h2 className="text-md font-semibold tracking-tight text-foreground">
            {`${index}. ${question.questionCode ?? question.subject.name}`}
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={QUESTION_STATUS_VARIANT[question.status]}>
              {QUESTION_STATUS_LABELS[question.status]}
            </Badge>
            <Badge variant={DIFFICULTY_VARIANT[question.difficulty]}>{question.difficulty}</Badge>
            <span className="text-sm text-muted-foreground">
              {[question.subject.name, question.topic?.name, `Version ${question.version}`]
                .filter(Boolean)
                .join(' · ')}
            </span>
          </div>
        </div>

        {canWrite ? (
          <span data-print-hide className="flex shrink-0 items-center gap-2">
            {action}
          </span>
        ) : null}
      </header>

      {question.languages
        .filter((language) => languages.includes(language))
        .map((language) => (
          <section key={language} className="flex flex-col gap-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {LANGUAGE_LABELS[language]}
            </h3>
            <QuestionInLanguage question={question} language={language} />
          </section>
        ))}
    </article>
  );
}
