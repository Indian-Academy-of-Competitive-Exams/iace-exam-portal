import {
  contentLanguageOf,
  LANGUAGE_MODE,
  type ExamQuestion,
  type LanguageCode,
  type LanguageMode,
} from '@iace/contracts';
import { RichContent, cn } from '@iace/ui';
import { LANGUAGE_LABELS } from '../../lib/constants';
import { htmlOf, shownLanguages } from './content';

/** The answers on offer. One radio group per question, lettered the way a paper letters them. */

export function OptionList({
  question,
  languages,
  languageMode,
  selectedOptionId,
  onSelect,
}: Readonly<{
  question: ExamQuestion;
  languages: readonly LanguageCode[];
  languageMode: LanguageMode;
  selectedOptionId: string | null;
  onSelect: (optionId: string) => void;
}>) {
  const shown = shownLanguages(languages, languageMode);

  return (
    <>
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
                  <RichContent
                    key={language}
                    lang={language.toLowerCase()}
                    className="text-sm leading-relaxed text-foreground"
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
    </>
  );
}
