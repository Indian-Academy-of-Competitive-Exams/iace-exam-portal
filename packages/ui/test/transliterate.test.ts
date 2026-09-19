import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { ScaffoldDocument, ScaffoldRegionNode } from '../src/components/ui/scaffold-region';
import {
  INDIC_SCRIPTS,
  Transliterate,
  transliterate,
  writeIn,
} from '../src/components/ui/rich-text-transliterate';

const hi = (word: string) => transliterate(word, INDIC_SCRIPTS.DEVANAGARI);
const te = (word: string) => transliterate(word, INDIC_SCRIPTS.TELUGU);

describe('typing an Indic script on a QWERTY keyboard', () => {
  it('writes Hindi from the way it sounds', () => {
    assert.equal(hi('namaste'), 'नमस्ते');
    assert.equal(hi('prashn'), 'प्रश्न');
    assert.equal(hi('uttar'), 'उत्तर');
    assert.equal(hi('vikalp'), 'विकल्प');
  });

  it('writes Telugu from the way it sounds', () => {
    assert.equal(te('prashna'), 'ప్రశ్న');
    assert.equal(te('samayam'), 'సమయం');
    assert.equal(te('ganitam'), 'గనితం');
  });

  /** ITRANS ends a consonant-final word with a virama, which written Hindi almost never does. */
  it('does not leave a halant hanging off the end of a Hindi word', () => {
    for (const word of ['aap', 'dhanyavaad', 'samay', 'bharat']) {
      assert.equal(hi(word).endsWith('्'), false, word);
    }
    assert.equal(hi('aap'), 'आप');
  });

  /** A Telugu word does not end in a bare m; it ends in the anusvara that sound is written with. */
  it('writes a final Telugu m as anusvara', () => {
    assert.equal(te('samayam').endsWith('ం'), true);
    assert.equal(te('samayam').endsWith('మ్'), false);
  });

  it('leaves a word with nothing to convert exactly as it was', () => {
    assert.equal(hi('123'), '123');
    assert.equal(te(''), '');
  });

  /** The two scripts are not the same map, and a word must never be written in the other one. */
  it('writes each language in its own script', () => {
    assert.notEqual(hi('prashna'), te('prashna'));
  });
});

/** ProseMirror calls this prop on every typed character; jsdom raises no input event of its own. */
function type(editor: Editor, text: string): void {
  for (const char of text) {
    const { from, to } = editor.state.selection;
    const plain = () => editor.state.tr.insertText(char, from, to);
    const handled = editor.view.someProp('handleTextInput', (handler) =>
      handler(editor.view, from, to, char, plain),
    );
    if (!handled) editor.view.dispatch(plain());
  }
}

/** Backspace reaches the plugin through handleKeyDown, which jsdom never fires on its own. */
function backspace(editor: Editor): void {
  const handled = editor.view.someProp('handleKeyDown', (handler) =>
    handler(editor.view, new KeyboardEvent('keydown', { key: 'Backspace' })),
  );
  if (!handled) {
    const { from } = editor.state.selection;
    editor.view.dispatch(editor.state.tr.delete(from - 1, from));
  }
}

const box = () => new Editor({ extensions: [StarterKit, Transliterate], content: '<p></p>' });

describe('the script the box is typing in', () => {
  it('types Roman letters through until a script is asked for', () => {
    const editor = box();
    type(editor, 'namaste ');
    assert.equal(editor.getText(), 'namaste ');
  });

  it('writes the asked-for script', () => {
    const editor = box();
    writeIn(editor.view, INDIC_SCRIPTS.DEVANAGARI);
    type(editor, 'namaste ');
    assert.equal(editor.getText(), 'नमस्ते ');
  });

  /** The bug this prevents: null read as "no script asked for", leaving Hindi on in English. */
  it('goes back to Roman letters when the box goes back to English', () => {
    const editor = box();
    writeIn(editor.view, INDIC_SCRIPTS.DEVANAGARI);
    type(editor, 'namaste ');
    writeIn(editor.view, null);
    type(editor, 'namaste ');
    assert.equal(editor.getText(), 'नमस्ते namaste ');
  });

  /** The romanised toggle: off and back on, without the box ever changing language. */
  it('takes the same script back after being turned off', () => {
    const editor = box();
    writeIn(editor.view, INDIC_SCRIPTS.DEVANAGARI);
    type(editor, 'namaste ');
    writeIn(editor.view, null);
    type(editor, 'namaste ');
    writeIn(editor.view, INDIC_SCRIPTS.DEVANAGARI);
    type(editor, 'namaste ');
    assert.equal(editor.getText(), 'नमस्ते namaste नमस्ते ');
  });

  it('swaps one script for the other', () => {
    const editor = box();
    writeIn(editor.view, INDIC_SCRIPTS.DEVANAGARI);
    type(editor, 'prashna ');
    writeIn(editor.view, INDIC_SCRIPTS.TELUGU);
    type(editor, 'prashna ');
    assert.equal(editor.getText(), 'प्रश्न ప్రశ్న ');
  });
});

describe('the word being written, before any space is typed', () => {
  it('shows the script from the first letter rather than waiting for a boundary', () => {
    const editor = box();
    writeIn(editor.view, INDIC_SCRIPTS.DEVANAGARI);
    type(editor, 'namaste');
    assert.equal(editor.getText(), 'नमस्ते');
  });

  /** The reason the word is rewritten whole: `d`, `dh` and `dha` are three different letters. */
  it('rewrites what came before when a letter changes it', () => {
    const editor = box();
    writeIn(editor.view, INDIC_SCRIPTS.DEVANAGARI);
    type(editor, 'd');
    assert.equal(editor.getText(), 'द');
    type(editor, 'h');
    assert.equal(editor.getText(), 'ध');
    type(editor, 'anyavaad');
    assert.equal(editor.getText(), 'धन्यवाद');
  });

  it('writes Telugu the same way', () => {
    const editor = box();
    writeIn(editor.view, INDIC_SCRIPTS.TELUGU);
    type(editor, 'prashna');
    assert.equal(editor.getText(), 'ప్రశ్న');
  });

  it('starts a new word after a boundary', () => {
    const editor = box();
    writeIn(editor.view, INDIC_SCRIPTS.DEVANAGARI);
    type(editor, 'namaste prashn');
    assert.equal(editor.getText(), 'नमस्ते प्रश्न');
  });

  /** Backspace takes back a LETTER TYPED, not a script character — several map to one. */
  it('takes back the letter that was typed, not the one on screen', () => {
    const editor = box();
    writeIn(editor.view, INDIC_SCRIPTS.DEVANAGARI);
    type(editor, 'dh');
    assert.equal(editor.getText(), 'ध');
    backspace(editor);
    assert.equal(editor.getText(), 'द');
    type(editor, 'in');
    assert.equal(editor.getText(), 'दिन');
  });

  it('empties the box when the whole word is taken back', () => {
    const editor = box();
    writeIn(editor.view, INDIC_SCRIPTS.DEVANAGARI);
    type(editor, 'na');
    backspace(editor);
    backspace(editor);
    assert.equal(editor.getText(), '');
  });
});

describe('a formula is not a word', () => {
  /** The bug: `$x$` is plain text until the closing dollar, so Hindi rewrote the LaTeX. */
  it('leaves an unclosed inline formula in Roman letters', () => {
    const editor = box();
    writeIn(editor.view, INDIC_SCRIPTS.DEVANAGARI);
    type(editor, '$x = at');
    assert.equal(editor.getText(), '$x = at');
  });

  it('leaves an unclosed block formula alone too', () => {
    const editor = box();
    writeIn(editor.view, INDIC_SCRIPTS.DEVANAGARI);
    type(editor, '$$x^2 + na');
    assert.equal(editor.getText(), '$$x^2 + na');
  });

  it('writes the script again once the formula is closed', () => {
    const editor = box();
    writeIn(editor.view, INDIC_SCRIPTS.DEVANAGARI);
    type(editor, '$x$ namaste');
    assert.equal(editor.getText(), '$x$ नमस्ते');
  });
});

/** The same node stack ScaffoldEditor builds, so a slot's own attributes reach the plugin. */
const slots = (html: string) =>
  new Editor({
    extensions: [
      StarterKit.configure({ document: false }),
      ScaffoldDocument,
      ScaffoldRegionNode,
      Transliterate,
    ],
    content: html,
  });

/** A slot nests its body in a div, so the plain text comes back with the block breaks around it. */
const said = (editor: Editor) => editor.getText().trim();

const REGION = (key: string, roman: boolean) =>
  `<div data-region="${key}" data-label="${key}" data-kind="named" data-roman="${roman ? 'true' : ''}">` +
  `<div class="scaffold-body"><p></p></div></div>`;

describe('a slot that holds a value rather than prose', () => {
  /** The bug: `B` became ब, answerIndexOf matched neither a letter nor a digit, and the key was lost. */
  it('leaves the answer line in Roman letters whatever script is chosen', () => {
    const editor = slots(REGION('answer', true));
    writeIn(editor.view, INDIC_SCRIPTS.DEVANAGARI);
    editor.commands.focus('start');
    type(editor, 'B');
    assert.equal(said(editor), 'B');
  });

  it('leaves it in Roman letters in Telugu too', () => {
    const editor = slots(REGION('answer', true));
    writeIn(editor.view, INDIC_SCRIPTS.TELUGU);
    editor.commands.focus('start');
    type(editor, 'C');
    assert.equal(said(editor), 'C');
  });

  it('still writes the script in a slot that holds prose', () => {
    const editor = slots(REGION('solution', false));
    writeIn(editor.view, INDIC_SCRIPTS.DEVANAGARI);
    editor.commands.focus('start');
    type(editor, 'namaste');
    assert.equal(said(editor), 'नमस्ते');
  });
});
