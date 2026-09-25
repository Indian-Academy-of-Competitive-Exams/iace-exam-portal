/** Narrowing and image urls shared by the paper a student sits and the review they read after. */
import {
  contentLanguageOf,
  type LanguageCode,
  type LocalizedContent,
  type LocalizedRich,
  type QuestionLanguage,
  type RichContent,
} from '@iace/contracts';
import { applyImageUrls } from '../questions';

/** Only the languages this sitting was taken in and the question has, each cut down by `pick`. */
export function narrowTo<T, R = T>(
  record: Partial<Record<QuestionLanguage, T>> | null,
  languages: readonly LanguageCode[],
  pick: (held: T) => R = (held) => held as unknown as R,
): Partial<Record<QuestionLanguage, R>> {
  const kept: Partial<Record<QuestionLanguage, R>> = {};
  for (const code of languages) {
    const key = contentLanguageOf(code);
    const held = record?.[key];
    if (held) kept[key] = pick(held);
  }
  return kept;
}

/** The HTML inside a run of rich nodes, which is where an image key hides. */
const htmlIn = (nodes: RichContent | undefined): string[] => (nodes ?? []).map((node) => node.text);

/** The same nodes with every image key replaced by the url that serves it. */
const serveRich = (
  nodes: RichContent | undefined,
  urls: ReadonlyMap<string, string>,
): RichContent => (nodes ?? []).map((node) => ({ ...node, text: applyImageUrls(node.text, urls) }));

interface ContentBearing {
  content: LocalizedContent;
  options: readonly { text: LocalizedRich }[];
}

/** Every piece of HTML a question carries — stem, any solution, and every option. */
export function htmlOfQuestion(question: ContentBearing): string[] {
  const content = Object.values(question.content).flatMap((held) => [
    ...htmlIn(held?.stem),
    ...htmlIn(held?.solution),
  ]);
  const options = question.options.flatMap((option) =>
    Object.values(option.text).flatMap((nodes) => htmlIn(nodes)),
  );
  return [...content, ...options];
}

/** The question with every image key resolved; a solution is resolved only where one was served. */
export function servedQuestion<Q extends ContentBearing>(
  question: Q,
  urls: ReadonlyMap<string, string>,
): Q {
  return {
    ...question,
    content: Object.fromEntries(
      Object.entries(question.content).map(([language, held]) => [
        language,
        held
          ? {
              ...held,
              stem: serveRich(held.stem, urls),
              ...(held.solution ? { solution: serveRich(held.solution, urls) } : {}),
            }
          : held,
      ]),
    ),
    options: question.options.map((option) => ({
      ...option,
      text: Object.fromEntries(
        Object.entries(option.text).map(([language, nodes]) => [language, serveRich(nodes, urls)]),
      ),
    })),
  };
}
