import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { INDIC_SCRIPTS, transliterate } from '../src/components/ui/rich-text-transliterate';

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
