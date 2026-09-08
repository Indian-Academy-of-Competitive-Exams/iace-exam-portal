import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
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
