/**
 * Roman letters into an Indic script, a word at a time. A typist on a QWERTY keyboard writes
 * `dhanyavaad` and the box holds धन्यवाद, with no input method to install and nothing to enable
 * on their machine. Deterministic and offline: there is no service behind this and no model.
 */
import Sanscript from '@indic-transliteration/sanscript';
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { type EditorView } from '@tiptap/pm/view';

export const INDIC_SCRIPTS = {
  DEVANAGARI: 'devanagari',
  TELUGU: 'telugu',
} as const;
export type IndicScript = (typeof INDIC_SCRIPTS)[keyof typeof INDIC_SCRIPTS];

/** What the typist is assumed to be writing. ITRANS is the scheme every Indic tool reads. */
const SCHEME = 'itrans';

const VIRAMA: Readonly<Record<IndicScript, string>> = {
  [INDIC_SCRIPTS.DEVANAGARI]: '्',
  [INDIC_SCRIPTS.TELUGU]: '్',
};

/** A word ends here, and what was typed before it is converted. */
const BOUNDARY = /^[\s.,;:?!()[\]{}"'‘’“”\-/]$/;

const ROMAN_LETTER = /[A-Za-z]/;

/** The run of Roman letters immediately behind the caret, which is the word being written. */
function romanTail(text: string): string {
  let start = text.length;
  while (start > 0 && ROMAN_LETTER.test(text[start - 1] ?? '')) start -= 1;
  return text.slice(start);
}

/** Longer than any word a typist writes, and short enough that the look-back costs nothing. */
const WORD_MAX = 48;

const convert = (Sanscript as unknown as { t: (text: string, from: string, to: string) => string })
  .t;

/** Devanagari and Telugu both have their own numerals; an exam paper is read in these. */
const INDIC_DIGITS = /[\u0966-\u096F\u0C66-\u0C6F]/g;

const DIGIT_ZERO = { devanagari: 0x0966, telugu: 0x0c66 } as const;

const asArabicDigits = (text: string) =>
  text.replace(INDIC_DIGITS, (digit) => {
    const code = digit.codePointAt(0) ?? 0;
    return String(code - (code >= DIGIT_ZERO.telugu ? DIGIT_ZERO.telugu : DIGIT_ZERO.devanagari));
  });

/** ITRANS ends a consonant with a virama, which written Hindi does not: `aap` is आप, not आप्. */
export function transliterate(word: string, script: IndicScript): string {
  if (script === INDIC_SCRIPTS.TELUGU) {
    return asArabicDigits(convert(word.replace(/m$/, 'M'), SCHEME, script));
  }

  const written = asArabicDigits(convert(word, SCHEME, script));
  return written.endsWith(VIRAMA[script]) ? written.slice(0, -1) : written;
}

/** The script lives in plugin state, so switching language is a transaction and not a ref. */
export const transliterateKey = new PluginKey<IndicScript | null>('transliterate');

/** Tells the editor which script to write from now on; null types every key through. */
export function writeIn(view: EditorView, script: IndicScript | null): void {
  view.dispatch(view.state.tr.setMeta(transliterateKey, script));
}

/** Replaces the word behind the caret with its script, then types the boundary that ended it. */
function rewriteWord(
  view: EditorView,
  from: number,
  to: number,
  typed: string,
  script: IndicScript,
): boolean {
  const behind = view.state.doc.textBetween(Math.max(0, from - WORD_MAX), from, '\n', '\n');
  const roman = romanTail(behind);
  if (roman === '') return false;

  const written = transliterate(roman, script);
  if (written === roman) return false;

  view.dispatch(view.state.tr.insertText(written + typed, from - roman.length, to));
  return true;
}

export const Transliterate = Extension.create({
  name: 'transliterate',

  addProseMirrorPlugins() {
    return [
      new Plugin<IndicScript | null>({
        key: transliterateKey,
        state: {
          init: () => null,
          // Only an absent meta means "keep": null is English asking to be typed through.
          apply: (tr, current) => {
            const asked = tr.getMeta(transliterateKey) as IndicScript | null | undefined;
            if (asked === undefined) return current;
            return asked;
          },
        },
        props: {
          handleTextInput: (view, from, to, text) => {
            if (!BOUNDARY.test(text)) return false;
            const script = transliterateKey.getState(view.state) ?? null;
            return script === null ? false : rewriteWord(view, from, to, text, script);
          },
        },
      }),
    ];
  },
});
