import {
  ANSWER_MODE,
  QUESTION_TYPE,
  plainTextOf,
  type QuestionDetail,
  type QuestionLanguage,
} from '@iace/contracts';
import { Badge, BadgeList, RichContent, Separator, StatRow } from '@iace/ui';

/** One question in one language: `plainTextOf` returns the stored MARKUP, so images and math render. */

export function QuestionInLanguage({
  question,
  language,
}: Readonly<{ question: QuestionDetail; language: QuestionLanguage }>) {
  const content = question.content[language];
  const solution = plainTextOf(content?.solution);

  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold tracking-tight text-foreground">Question</h3>
        <RichContent
          lang={language}
          className="text-sm text-foreground"
          html={plainTextOf(content?.stem)}
        />
      </section>

      {question.type === QUESTION_TYPE.SINGLE_MCQ ? (
        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold tracking-tight text-foreground">Options</h3>
          <ol className="flex flex-col gap-2">
            {question.options.map((option, index) => (
              <li key={option.id} className="flex items-start gap-3 text-sm">
                <span className="w-5 shrink-0 font-medium text-muted-foreground">
                  {String.fromCodePoint(65 + index)}
                </span>
                <RichContent
                  lang={language}
                  className="min-w-0 flex-1 text-foreground"
                  html={plainTextOf(option.text[language])}
                />
                {option.isCorrect ? <Badge variant="success">Correct</Badge> : null}
              </li>
            ))}
          </ol>
        </section>
      ) : (
        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold tracking-tight text-foreground">Answer</h3>
          <StatRow
            label={question.answerKey?.mode === ANSWER_MODE.NUMERIC ? 'Numeric' : 'Exact text'}
            value={question.answerKey?.answers[language] || '—'}
          />
          {question.answerKey?.tolerance == null ? null : (
            <StatRow label="Tolerance" value={`± ${question.answerKey.tolerance}`} />
          )}
        </section>
      )}

      {solution ? (
        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold tracking-tight text-foreground">Solution</h3>
          <RichContent lang={language} className="text-sm text-foreground" html={solution} />
        </section>
      ) : null}
    </div>
  );
}

/** What a question is filed as, above whichever languages follow it. */
export function QuestionFacts({ question }: Readonly<{ question: QuestionDetail }>) {
  return (
    <>
      <div className="grid gap-x-8 gap-y-2 sm:grid-cols-2">
        <StatRow label="Subject" value={question.subject.name} />
        <StatRow label="Topic" value={question.topic?.name ?? '—'} />
        <StatRow label="Difficulty" value={question.difficulty} />
        <StatRow label="Version" value={question.version} />
      </div>

      {question.tags.length > 0 ? (
        <BadgeList items={question.tags} label={(tag) => tag} max={8} />
      ) : null}

      <Separator />
    </>
  );
}
