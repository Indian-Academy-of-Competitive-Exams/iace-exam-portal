import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  TYPED_WORD,
  TYPING_PRESETS,
  scoreTyping,
  typablePassage,
  typingKeyDepressions,
  typingPassageNeed,
  typingPassageText,
} from '../src/index';

const SSC = TYPING_PRESETS.SSC_CHSL_TYPING_EN;
const RRB = TYPING_PRESETS.RRB_NTPC_TYPING_EN;
const DEST = TYPING_PRESETS.SSC_CGL_DEST;
const DEO = TYPING_PRESETS.SSC_CHSL_DEO_8000;

/** Distinct four-letter words, so each with its space is exactly five key depressions. */
function passageOf(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `w${String(index).padStart(3, '0')}`);
}

const kindsOf = (passage: string, typed: string) =>
  scoreTyping(passage, typed, SSC).words.map((word) => word.kind);

describe('scoreTyping', () => {
  it('qualifies a clean passage typed at the target speed', () => {
    const words = passageOf(400);
    const result = scoreTyping(words.join(' '), words.slice(0, 351).join(' '), SSC);

    assert.equal(result.wordsTyped, 351);
    assert.equal(result.fullMistakes, 0);
    assert.equal(result.errorPct, 0);
    assert.ok(result.grossWpm >= SSC.target);
    assert.equal(result.qualified, true);
  });

  it('does not count the passage they never reached', () => {
    const words = passageOf(400);
    const result = scoreTyping(words.join(' '), words.slice(0, 10).join(' '), SSC);

    assert.equal(result.fullMistakes, 0);
    assert.equal(result.words.length, 10);
    assert.equal(result.qualified, false);
  });

  it('charges a skipped word once, not every word after it', () => {
    assert.deepEqual(kindsOf('the quick brown fox jumps', 'the brown fox jumps'), [
      TYPED_WORD.RIGHT,
      TYPED_WORD.MISSED,
      TYPED_WORD.RIGHT,
      TYPED_WORD.RIGHT,
      TYPED_WORD.RIGHT,
    ]);
  });

  it('charges an added word once', () => {
    const result = scoreTyping('the quick fox', 'the very quick fox', SSC);

    assert.equal(result.fullMistakes, 1);
    assert.equal(result.words[1]?.kind, TYPED_WORD.EXTRA);
  });

  it('counts capitals and punctuation as half a mistake, a wrong word as a whole one', () => {
    const result = scoreTyping('Delhi is hot, today.', 'delhi is hot today. ', SSC);
    const wrong = scoreTyping('Delhi is hot', 'Delhi is cold', SSC);

    assert.equal(result.halfMistakes, 2);
    assert.equal(result.fullMistakes, 0);
    assert.equal(result.errorPct, 25);
    assert.equal(wrong.fullMistakes, 1);
    assert.equal(wrong.halfMistakes, 0);
  });

  it('refuses a fast candidate whose errors pass the ceiling', () => {
    const words = passageOf(400);
    const typed = words.slice(0, 360).map((word, index) => (index % 10 === 0 ? 'oops' : word));
    const result = scoreTyping(words.join(' '), typed.join(' '), SSC);

    assert.equal(result.targetMet, true);
    assert.equal(result.errorPct, 10);
    assert.equal(result.qualified, false);
  });

  it('ignores the allowance and takes ten words for each mistake beyond it', () => {
    const words = passageOf(400);
    const withMistakes = (count: number) =>
      words.slice(0, 320).map((word, index) => (index < count ? 'oops' : word));

    const within = scoreTyping(words.join(' '), withMistakes(16).join(' '), RRB);
    const beyond = scoreTyping(words.join(' '), withMistakes(20).join(' '), RRB);

    assert.equal(within.netWpm, within.grossWpm);
    assert.equal(within.qualified, true);
    assert.equal(beyond.netWpm, 27.98);
    assert.equal(beyond.qualified, false);
  });

  it('holds a data-entry test to its key depressions, not to words a minute', () => {
    const words = passageOf(500);
    const short = scoreTyping(words.join(' '), words.slice(0, 399).join(' '), DEST);
    const enough = scoreTyping(words.join(' '), words.slice(0, 401).join(' '), DEST);

    assert.equal(short.keyDepressions, 1994);
    assert.equal(short.qualified, false);
    assert.equal(enough.keyDepressions, 2004);
    assert.equal(enough.qualified, true);
  });

  it('scales key depressions to the hour for a per-hour standard', () => {
    const words = passageOf(500);
    const result = scoreTyping(words.join(' '), words.slice(0, 401).join(' '), DEO);

    assert.equal(result.keyDepressionsPerHour, 8016);
    assert.equal(result.qualified, true);
  });

  it('reads a typeset quote or dash as the key that types it', () => {
    const result = scoreTyping('“It’s over” — he said…', '"It\'s over" - he said...', SSC);

    assert.equal(result.fullMistakes + result.halfMistakes, 0);
  });

  it('qualifies nobody who typed nothing', () => {
    const result = scoreTyping('the quick brown fox', '   ', SSC);

    assert.equal(result.wordsTyped, 0);
    assert.equal(result.qualified, false);
    assert.deepEqual(result.words, []);
  });

  it('stops comparing at twice the passage, however much was pasted in', () => {
    const result = scoreTyping('one two three', 'x '.repeat(5000), SSC);

    assert.equal(result.wordsTyped, 6);
  });
});

describe('typing passages', () => {
  it('folds line breaks and runs of spaces to single spaces', () => {
    assert.equal(typablePassage('  one\n\ntwo \t three '), 'one two three');
  });

  it('needs a passage as long as the standard, in key depressions', () => {
    assert.equal(typingPassageNeed(SSC), 1750);
    assert.equal(typingPassageNeed(DEST), 2000);
    assert.equal(typingPassageNeed(TYPING_PRESETS.SSC_CHSL_DEO_15000), 3750);
  });
});

describe('scoreTyping at its edges', () => {
  it('qualifies a candidate exactly at the error ceiling', () => {
    const words = passageOf(400);
    const typed = words.map((word, index) => (index < 28 ? 'oops' : word));
    const result = scoreTyping(words.join(' '), typed.join(' '), SSC);

    assert.equal(result.errorPct, 7);
    assert.equal(result.qualified, true);
  });

  it('does not charge the word the clock stopped them in', () => {
    const result = scoreTyping('the cat sat down', 'the cat sa', SSC);

    assert.equal(result.fullMistakes + result.halfMistakes, 0);
  });

  it('tells two Hindi words apart by their vowel signs', () => {
    const result = scoreTyping('की कि क', 'कि क की', SSC);

    assert.equal(result.halfMistakes, 0);
    assert.ok(result.fullMistakes > 0);
  });
});

describe('scoreTyping against a held key', () => {
  /** The failure this prevents: twenty words and one key held down reading as a qualifying speed. */
  it('counts a word for no more than the longest the passage holds', () => {
    const words = passageOf(400);
    const junk = [...words.slice(0, 20), 'x'.repeat(1700)].join(' ');
    const result = scoreTyping(words.join(' '), junk, SSC);

    assert.equal(result.keyDepressions, 20 * 4 + 4 + 20);
    assert.equal(result.qualified, false);
    assert.equal(typingKeyDepressions(words.join(' '), junk), result.keyDepressions);
  });
});

describe('typingPassageText', () => {
  it('keeps the words either side of a line break apart', () => {
    assert.equal(
      typingPassageText('<p>one<br>two<br />three</p><p>four</p>'),
      'one two three four',
    );
  });
});
