import { LANGUAGE_MODE, type LanguageCode, type LanguageMode } from '@iace/contracts';

/** Which languages a paper shows, and how its stored nodes become the markup to render. */

export const shownLanguages = (
  languages: readonly LanguageCode[],
  mode: LanguageMode,
): readonly LanguageCode[] => (mode === LANGUAGE_MODE.DUAL ? languages : languages.slice(0, 1));

export const htmlOf = (nodes: { text: string }[] | undefined): string =>
  (nodes ?? []).map((node) => node.text).join('');
