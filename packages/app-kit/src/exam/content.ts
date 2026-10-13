import {
  contentLanguageOf,
  LANGUAGE_MODE,
  type LanguageCode,
  type LanguageMode,
  type LocalizedContent,
} from '@iace/contracts';

/** Which languages a paper shows, and how its stored nodes become the markup to render. */

export const shownLanguages = (
  languages: readonly LanguageCode[],
  mode: LanguageMode,
): readonly LanguageCode[] => (mode === LANGUAGE_MODE.DUAL ? languages : languages.slice(0, 1));

export const htmlOf = (nodes: { text: string }[] | undefined): string =>
  (nodes ?? []).map((node) => node.text).join('');

/** The passage a question is asked about, per language on screen that has one. Empty means there is none to draw. */
export function passagesOf(
  content: LocalizedContent,
  languages: readonly LanguageCode[],
  mode: LanguageMode,
): { language: LanguageCode; html: string }[] {
  return shownLanguages(languages, mode).flatMap((language) => {
    const html = htmlOf(content[contentLanguageOf(language)]?.passage);
    return html === '' ? [] : [{ language, html }];
  });
}
