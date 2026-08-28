import {
  contentLanguageOf,
  type ExamQuestion,
  type LanguageCode,
  type LanguageMode,
} from '@iace/contracts';
import { Badge, RichContent } from '@iace/ui';
import { htmlOf, shownLanguages } from './content';

/** The question itself. A DUAL paper shows both languages, with nothing to choose. */

export function QuestionStem({
  question,
  index,
  languages,
  languageMode,
}: Readonly<{
  question: ExamQuestion;
  index: number;
  languages: readonly LanguageCode[];
  languageMode: LanguageMode;
}>) {
  const shown = shownLanguages(languages, languageMode);

  return (
    <>
      <header className="flex flex-wrap items-center gap-3">
        <h2 className="text-sm font-semibold text-foreground">{`Question ${index + 1}`}</h2>
        <Badge variant="success">{`+${question.marks}`}</Badge>
        {question.negativeMarks > 0 ? (
          <Badge variant="danger">{`−${question.negativeMarks}`}</Badge>
        ) : null}
      </header>

      {shown.map((language) => (
        <RichContent
          key={language}
          lang={language.toLowerCase()}
          className="text-sm leading-relaxed text-foreground"
          html={htmlOf(question.content[contentLanguageOf(language)]?.stem)}
        />
      ))}
    </>
  );
}
