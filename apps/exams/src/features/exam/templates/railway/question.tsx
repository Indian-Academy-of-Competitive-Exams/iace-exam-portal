/**
 * The railway paper: the same content pipeline as the default skin, in the original's
 * markup. The chrome around it already names the question and its marks, so nothing
 * here repeats them.
 */
import {
  contentLanguageOf,
  type ExamQuestion,
  type LanguageCode,
  type LanguageMode,
} from '@iace/contracts';
import { htmlOf, shownLanguages } from '@iace/app-kit';
import { RichContent } from '@iace/ui';

export function RailwayQuestion({
  question,
  languages,
  languageMode,
}: Readonly<{
  question: ExamQuestion;
  languages: readonly LanguageCode[];
  languageMode: LanguageMode;
}>) {
  return (
    <>
      {shownLanguages(languages, languageMode).map((language) => (
        <RichContent
          key={language}
          lang={language.toLowerCase()}
          html={htmlOf(question.content[contentLanguageOf(language)]?.stem)}
        />
      ))}
    </>
  );
}

export function RailwayOptions({
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
    <div className="option">
      {question.options.map((option) => (
        <label className="optn" key={option.id}>
          <input
            type="radio"
            className="rdobtn"
            name={`q-${question.questionId}`}
            checked={option.id === selectedOptionId}
            onChange={() => onSelect(option.id)}
          />
          <span>
            {shown.map((language) => (
              <RichContent
                key={language}
                lang={language.toLowerCase()}
                html={htmlOf(option.text[contentLanguageOf(language)])}
              />
            ))}
          </span>
        </label>
      ))}
    </div>
  );
}
