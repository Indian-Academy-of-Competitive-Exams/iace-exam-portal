import {
  contentLanguageOf,
  LANGUAGE_MODE,
  type ExamQuestion,
  type LanguageCode,
  type LanguageMode,
} from '@iace/contracts';
import { Badge, cn } from '@iace/ui';
import { LANGUAGE_LABELS } from '../../lib/constants';

/** One question as a candidate sees it. A DUAL paper shows both languages, with nothing to choose. */

/** The content is the bank's own markup — images and equations are why it is not plain text. */
function Rich({ html, lang }: Readonly<{ html: string; lang: string }>) {
  return (
    <div
      lang={lang}
      className="exam-rich text-sm leading-relaxed text-foreground [&_img]:my-2 [&_img]:max-w-full"
      // The bank's own markup, authored in admin: images and equations are why this is not text.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

const htmlOf = (nodes: { text: string }[] | undefined): string =>
  (nodes ?? []).map((node) => node.text).join('');

export function QuestionBody({
  question,
  index,
  languages,
  languageMode,
  selectedOptionId,
  onSelect,
}: Readonly<{
  question: ExamQuestion;
  index: number;
  languages: readonly LanguageCode[];
  languageMode: LanguageMode;
  selectedOptionId: string | null;
  onSelect: (optionId: string) => void;
}>) {
  const shown = languageMode === LANGUAGE_MODE.DUAL ? languages : languages.slice(0, 1);

  return (
    <article className="flex min-w-0 flex-col gap-4">
      <header className="flex flex-wrap items-center gap-3">
        <h2 className="text-sm font-semibold text-foreground">{`Question ${index + 1}`}</h2>
        <Badge variant="success">{`+${question.marks}`}</Badge>
        {question.negativeMarks > 0 ? (
          <Badge variant="danger">{`−${question.negativeMarks}`}</Badge>
        ) : null}
      </header>

      {shown.map((language) => (
        <Rich
          key={language}
          lang={language.toLowerCase()}
          html={htmlOf(question.content[contentLanguageOf(language)]?.stem)}
        />
      ))}

      <ol className="flex flex-col gap-2">
        {question.options.map((option, position) => (
          <li key={option.id}>
            <label
              className={cn(
                'flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors',
                option.id === selectedOptionId
                  ? 'border-primary bg-primary/5'
                  : 'border-border hover:bg-muted/50',
              )}
            >
              <input
                type="radio"
                name={`q-${question.questionId}`}
                className="mt-0.5 size-4 shrink-0 accent-[--color-primary]"
                checked={option.id === selectedOptionId}
                onChange={() => onSelect(option.id)}
              />
              <span className="w-5 shrink-0 text-sm font-medium text-muted-foreground">
                {String.fromCodePoint(65 + position)}
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-1">
                {shown.map((language) => (
                  <Rich
                    key={language}
                    lang={language.toLowerCase()}
                    html={htmlOf(option.text[contentLanguageOf(language)])}
                  />
                ))}
              </span>
            </label>
          </li>
        ))}
      </ol>

      {languageMode !== LANGUAGE_MODE.DUAL && languages.length > 1 ? (
        <p className="text-xs text-muted-foreground">{`Shown in ${LANGUAGE_LABELS[shown[0]!]}`}</p>
      ) : null}
    </article>
  );
}
