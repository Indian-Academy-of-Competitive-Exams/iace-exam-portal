/** Narrowing and image-signing shared by the paper a student sits and the review they read after. */
import {
  contentLanguageOf,
  type LanguageCode,
  type LocalizedRich,
  type RichContent,
} from '@iace/contracts';
import { applyImageUrls } from '../questions';

/** Only the languages this sitting was taken in, and only the ones the question actually has. */
export function narrowRich(text: LocalizedRich, languages: readonly LanguageCode[]): LocalizedRich {
  const kept: LocalizedRich = {};
  for (const code of languages) {
    const key = contentLanguageOf(code);
    const held = text?.[key];
    if (held) kept[key] = held;
  }
  return kept;
}

/** The HTML inside a run of rich nodes, which is where an image key hides. */
export const htmlIn = (nodes: RichContent | undefined): string[] =>
  (nodes ?? []).map((node) => node.text);

/** The same nodes with every image key replaced by a URL that will still be live in an hour. */
export const signRich = (
  nodes: RichContent | undefined,
  urls: ReadonlyMap<string, string>,
): RichContent => (nodes ?? []).map((node) => ({ ...node, text: applyImageUrls(node.text, urls) }));

export function signLocalizedRich(
  text: LocalizedRich,
  urls: ReadonlyMap<string, string>,
): LocalizedRich {
  return Object.fromEntries(
    Object.entries(text).map(([language, nodes]) => [language, signRich(nodes, urls)]),
  );
}
