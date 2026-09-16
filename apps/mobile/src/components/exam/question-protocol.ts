/**
 * Both directions of QuestionContent's bridge, as pure functions. Out goes the
 * whole screen; in comes whatever the page posted, which is refused unless it
 * is well formed AND names something the screen on show would let a student do.
 */
import { z } from 'zod';
import {
  ANSWER_STATE,
  contentLanguageOf,
  omrFillFor,
  TEST_UI,
  type ExamQuestion,
  type ExamTemplate,
  type LanguageCode,
  type LanguageMode,
  type QuestionLanguage,
  type RichContent,
  type TestUi,
} from '@iace/contracts';
import { htmlOf, shownLanguages } from '@iace/app-kit';
import {
  PAGE_MESSAGE,
  PRELOAD_IMAGES,
  SHOW_QUESTION,
  type PageMessage,
  type QuestionScreen,
  type ScreenContent,
} from './question-bridge';

export interface ScreenInput {
  question: ExamQuestion;
  languages: readonly LanguageCode[];
  languageMode: LanguageMode;
  testUi: TestUi;
  examTemplate: ExamTemplate;
  selectedOptionId: string | null;
  marked: boolean;
}

export function questionScreen({
  question,
  languages,
  languageMode,
  testUi,
  examTemplate,
  selectedOptionId,
  marked,
}: Readonly<ScreenInput>): QuestionScreen {
  const shown = shownLanguages(languages, languageMode).map(contentLanguageOf);
  const inShown = (
    pick: (language: QuestionLanguage) => RichContent | undefined,
  ): ScreenContent[] => shown.map((language) => ({ lang: language, html: htmlOf(pick(language)) }));
  const bubbling = testUi === TEST_UI.OMR;
  const heldFill = omrFillFor(marked ? ANSWER_STATE.ANSWERED_MARKED : ANSWER_STATE.ANSWERED);

  return {
    template: examTemplate.toLowerCase(),
    bubbling,
    // Committed: an option is held and the question is not flagged, so the ink is dry.
    locked: bubbling && selectedOptionId !== null && !marked,
    selectedOptionId,
    stem: inShown((language) => question.content[language]?.stem),
    options: question.options.map((option) => ({
      id: option.id,
      fill: option.id === selectedOptionId ? heldFill : 0,
      content: inShown((language) => option.text[language]),
    })),
  };
}

/** JSON is valid JavaScript, so the screen goes in as a literal and is never parsed from a string. */
export const showScript = (screen: QuestionScreen): string =>
  `window.${SHOW_QUESTION}(${JSON.stringify(screen)});true;`;

/** Every shown-language stem and option, raw and deduped; the page sanitises before it looks for images. */
export function preloadHtmlOf(
  questions: readonly ExamQuestion[],
  languages: readonly LanguageCode[],
  languageMode: LanguageMode,
): readonly string[] {
  const shown = shownLanguages(languages, languageMode).map(contentLanguageOf);
  const html = questions.flatMap((question) => [
    ...shown.map((language) => htmlOf(question.content[language]?.stem)),
    ...question.options.flatMap((option) => shown.map((language) => htmlOf(option.text[language]))),
  ]);
  return [...new Set(html)];
}

/** Same JSON-literal pattern as `showScript`; the page reads the array itself, native never parses HTML. */
export const preloadScript = (html: readonly string[]): string =>
  `window.${PRELOAD_IMAGES}(${JSON.stringify(html)});true;`;

const optionIdSchema = z.string().min(1);

const pageMessageSchema: z.ZodType<PageMessage> = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal(PAGE_MESSAGE.READY) }),
  z.strictObject({ type: z.literal(PAGE_MESSAGE.CHOOSE), optionId: optionIdSchema }),
  z.strictObject({
    type: z.literal(PAGE_MESSAGE.BUBBLE),
    optionId: optionIdSchema,
    fill: z.number().gt(0).lte(1),
  }),
]);

function parsed(data: string): unknown {
  try {
    return JSON.parse(data);
  } catch {
    return undefined;
  }
}

/** Whether this screen offers what the message asks for — a stale or forged one names what it does not. */
function allowedOn(message: PageMessage, screen: QuestionScreen): boolean {
  if (message.type === PAGE_MESSAGE.READY) return true;
  if (!screen.options.some((option) => option.id === message.optionId)) return false;
  if (message.type === PAGE_MESSAGE.CHOOSE) return !screen.bubbling;
  return screen.bubbling && !screen.locked;
}

/** The only way a page message reaches native code. Anything it cannot vouch for is null. */
export function readPageMessage(data: string, screen: QuestionScreen): PageMessage | null {
  const result = pageMessageSchema.safeParse(parsed(data));
  return result.success && allowedOn(result.data, screen) ? result.data : null;
}
