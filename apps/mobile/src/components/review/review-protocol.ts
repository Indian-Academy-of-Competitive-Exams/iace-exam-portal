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
  type ScoreCardQuestion,
  type SolutionQuestion,
} from '@iace/contracts';
import { htmlOf, shownLanguages } from '@iace/app-kit';
import { type QuestionScreen, type ScreenContent } from '../exam/question-bridge';

/** One question as the review holds it: always their own answer, the key only past the gate. */
export type ReviewedQuestion = ScoreCardQuestion & Partial<SolutionQuestion>;

/** How a question went, which is what colours a palette cell and the marker beside an option. */
export const VERDICT = { RIGHT: 'RIGHT', WRONG: 'WRONG', LEFT: 'LEFT' } as const;
export type Verdict = (typeof VERDICT)[keyof typeof VERDICT];

export function verdictOf(question: ReviewedQuestion): Verdict {
  if (question.isCorrect === true) return VERDICT.RIGHT;
  return question.isCorrect === false ? VERDICT.WRONG : VERDICT.LEFT;
}

export interface ReviewInput {
  question: ReviewedQuestion;
  languages: readonly LanguageCode[];
  languageMode: LanguageMode;
}

export function reviewScreen({
  question,
  languages,
  languageMode,
}: Readonly<ReviewInput>): QuestionScreen {
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
      answerKey: keyText(question, shown),
      // A question nobody wrote a solution for must not draw an empty block headed Solution.
      solution: inShown((language) => question.content?.[language]?.solution).filter(
        (block) => block.html !== '',
      ),
    },
  };
}

/** A typed answer is compared against the key in the language it was written in. */
function keyText(question: ReviewedQuestion, shown: readonly QuestionLanguage[]): string | null {
  const answers = question.answerKey?.answers;
  if (!answers) return null;
  const said = shown.map((language) => answers[language]).find((text) => Boolean(text));
  return said ?? null;
}
