/**
 * The review's side of the question page's bridge. It builds the same screen a
 * sitting does, locked, plus what the key said — and it says nothing the gate
 * has not already handed over, since a question with no solution has no key.
 */
import {
  contentLanguageOf,
  EXAM_TEMPLATE,
  type LanguageCode,
  type LanguageMode,
  type QuestionLanguage,
  type RichContent,
} from '@iace/contracts';
import { answerKeyText, htmlOf, shownLanguages, type ReviewedQuestion } from '@iace/app-kit';
import { type QuestionScreen, type ScreenContent } from '../exam/question-bridge';

export interface ReviewInput {
  question: ReviewedQuestion;
  languages: readonly LanguageCode[];
  languageMode: LanguageMode;
}

export function reviewScreen({
  question,
  languages,
  languageMode,
}: Readonly<ReviewInput>): Omit<QuestionScreen, 'theme'> {
  const shown = shownLanguages(languages, languageMode).map(contentLanguageOf);
  const inShown = (
    pick: (language: QuestionLanguage) => RichContent | undefined,
  ): ScreenContent[] => shown.map((language) => ({ lang: language, html: htmlOf(pick(language)) }));

  return {
    template: EXAM_TEMPLATE.DEFAULT.toLowerCase(),
    bubbling: false,
    locked: true,
    selectedOptionId: question.selectedOptionId,
    stem: inShown((language) => question.content?.[language]?.stem),
    options: (question.options ?? []).map((option) => ({
      id: option.id,
      fill: 0,
      content: inShown((language) => option.text[language]),
    })),
    review: {
      correctOptionId: question.options?.find((option) => option.isCorrect)?.id ?? null,
      typedAnswer: question.typedAnswer,
      answerKey: answerKeyText(question, shown),
      // A question nobody wrote a solution for must not draw an empty block headed Solution.
      solution: inShown((language) => question.content?.[language]?.solution).filter(
        (block) => block.html !== '',
      ),
    },
  };
}
