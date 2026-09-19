/**
 * Roman letters into an Indic script, a word at a time. A typist on a QWERTY keyboard writes
 * `dhanyavaad` and the box holds धन्यवाद, with no input method to install and nothing to enable
 * on their machine. Deterministic and offline: there is no service behind this and no model.
 * The open word is rewritten WHOLE on each keystroke: `d`, `dh` and `dha` are three different letters.
 */
import Sanscript from '@indic-transliteration/sanscript';
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { type ResolvedPos } from '@tiptap/pm/model';
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

/** Anything else ends the word: a space, a full stop, a digit, a dollar opening a formula. */
const ROMAN_LETTER = /[A-Za-z]/;

const convert = (Sanscript as unknown as { t: (text: string, from: string, to: string) => string })
  .t;

/** Devanagari and Telugu both have their own numerals; an exam paper is read in these. */
const INDIC_DIGITS = /[०-९౦-౯]/g;

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

/** The word being written: the Roman behind it, and where its script stands in the document. */
interface OpenWord {
  roman: string;
  from: number;
  to: number;
}

interface TypingState {
  script: IndicScript | null;
  word: OpenWord | null;
}

const IDLE: TypingState = { script: null, word: null };

/** Carried only by this plugin's own transactions, so any other edit closes the open word. */
const OPEN_WORD = 'transliterateOpenWord';

/** The script lives in plugin state, so switching language is a transaction and not a ref. */
export const transliterateKey = new PluginKey<TypingState>('transliterate');

/** Tells the editor which script to write from now on; null types every key through. */
export function writeIn(view: EditorView, script: IndicScript | null): void {
  view.dispatch(view.state.tr.setMeta(transliterateKey, script));
}

/** A `$…$` opened and not yet closed holds LaTeX, and `x` in a formula is a variable, not a word. */
function inOpenMath(pos: ResolvedPos): boolean {
  // A closed formula is already an atom by now, so only the run being typed leaves dollars behind.
  const before = pos.parent.textBetween(0, pos.parentOffset, '\n', '\n');
  let open = false;
  for (let i = 0; i < before.length; i += 1) {
    if (before[i] !== '$') continue;
    if (before[i + 1] === '$') i += 1;
    open = !open;
  }
  return open;
}

/** A slot marked `roman` holds a value — an option letter, a number — and never a word. */
function inRomanSlot(pos: ResolvedPos): boolean {
  for (let depth = pos.depth; depth > 0; depth -= 1) {
    if (pos.node(depth).attrs.roman) return true;
  }
  return false;
}

/** Where a word may begin. Checked once a word rather than once a key, since only a letter opens one. */
function mayWrite(view: EditorView, at: number): boolean {
  const pos = view.state.doc.resolve(at);
  return !inRomanSlot(pos) && !inOpenMath(pos);
}

/** Replaces the whole open word, because one more letter can change every letter before it. */
function rewrite(view: EditorView, word: OpenWord, roman: string, script: IndicScript): void {
  const written = roman === '' ? '' : transliterate(roman, script);
  const tr = view.state.tr;
  if (written === '') tr.delete(word.from, word.to);
  else tr.insertText(written, word.from, word.to);
  const still = roman === '' ? null : { roman, from: word.from, to: word.from + written.length };
  view.dispatch(tr.setMeta(OPEN_WORD, still));
}

export const Transliterate = Extension.create({
  name: 'transliterate',

  addProseMirrorPlugins() {
    return [
      new Plugin<TypingState>({
        key: transliterateKey,
        state: {
          init: () => IDLE,
          // Only an absent meta means "keep": null is English asking to be typed through.
          apply: (tr, current) => {
            const asked = tr.getMeta(transliterateKey) as IndicScript | null | undefined;
            const script = asked === undefined ? current.script : asked;
            const opened = tr.getMeta(OPEN_WORD) as OpenWord | null | undefined;
            if (opened !== undefined) return { script, word: opened };
            const ours = asked === undefined && !tr.docChanged && !tr.selectionSet;
            return { script, word: ours ? current.word : null };
          },
        },
        props: {
          handleTextInput: (view, from, to, text) => {
            const { script, word } = transliterateKey.getState(view.state) ?? IDLE;
            if (script === null) return false;

            if (!ROMAN_LETTER.test(text)) {
              if (word) view.dispatch(view.state.tr.setMeta(OPEN_WORD, null));
              return false;
            }

            const open = word && word.to === from && from === to ? word : null;
            if (!open && !mayWrite(view, from)) return false;

            rewrite(view, open ?? { roman: '', from, to }, (open?.roman ?? '') + text, script);
            return true;
          },

          // Without this, backspace eats one SCRIPT letter and the Roman behind it stops matching.
          handleKeyDown: (view, event) => {
            if (event.key !== 'Backspace') return false;
            const { script, word } = transliterateKey.getState(view.state) ?? IDLE;
            const { empty, from } = view.state.selection;
            if (script === null || !word || !empty || from !== word.to) return false;

            rewrite(view, word, word.roman.slice(0, -1), script);
            return true;
          },
        },
      }),
    ];
  },
});
