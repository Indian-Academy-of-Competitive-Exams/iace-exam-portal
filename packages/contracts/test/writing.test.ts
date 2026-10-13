import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { WRITING_FORMAT, keyPointsOf, scoreWriting } from '../src/index';

const POINTS = ['financial inclusion', 'rural branches', 'digital payments'];
const words = (count: number, word = 'word') => Array.from({ length: count }, () => word).join(' ');

/** Distinct words, so a filler sentence repeats none of them. */
const filler = (count: number) => Array.from({ length: count }, (_, at) => `Term${at}`).join(' ');

const essay = (body: string) =>
  ['Banks reach every village.', body, 'That is the way forward.'].join('\n\n');

describe('scoreWriting', () => {
  it('pays in full for an answer that makes every point, inside the limit, in its format', () => {
    const answer = essay(
      `Financial inclusion grows when rural branches open. Digital payments help too. ${filler(40)}.`,
    );
    const result = scoreWriting(
      answer,
      { format: WRITING_FORMAT.ESSAY, minWords: 40, maxWords: 80 },
      POINTS,
    );

    assert.equal(result.score, 1);
    assert.deepEqual(
      result.keyPoints.map((point) => point.found),
      [true, true, true],
    );
  });

  it("finds a point whatever its words' order or case, and misses one that is not made", () => {
    const result = scoreWriting(
      'Inclusion, FINANCIAL and otherwise, matters. Branches are few.',
      undefined,
      POINTS,
    );

    assert.deepEqual(
      result.keyPoints.map((point) => point.found),
      [true, false, false],
    );
    assert.equal(result.shares.keyPoints, 0.33);
  });

  it('pays less for an answer under the lower limit, and nothing for length at half of it', () => {
    const rubric = { format: WRITING_FORMAT.OTHER, minWords: 100, maxWords: 200 };

    assert.equal(scoreWriting(words(100), rubric, POINTS).shares.length, 1);
    assert.equal(scoreWriting(words(75), rubric, POINTS).shares.length, 0.5);
    assert.equal(scoreWriting(words(50), rubric, POINTS).shares.length, 0);
    assert.equal(scoreWriting(words(300), rubric, POINTS).shares.length, 0.5);
  });

  it('checks a letter for its salutation, its subject line and its close', () => {
    const rubric = { format: WRITING_FORMAT.LETTER };
    const whole =
      'Dear Sir,\nSubject: Opening an account\nPlease open one.\nYours faithfully,\nAna';
    const bare = 'Please open an account for me.';

    assert.equal(scoreWriting(whole, rubric, POINTS).shares.format, 1);
    assert.equal(scoreWriting(bare, rubric, POINTS).shares.format, 0);
  });

  it('gives an attempt of fair length full marks where no key point was named, and says so', () => {
    const attempted = scoreWriting(words(50), undefined, []);
    const token = scoreWriting(words(10), undefined, []);

    assert.deepEqual([attempted.score, attempted.attemptOnly], [1, true]);
    assert.equal(token.score, 0);
  });

  /** The failure this prevents: a few tidy words on any subject earning marks for length and form alone. */
  it('pays nothing for an answer that makes none of its points, however well formed', () => {
    const tidy = essay(`${filler(60)}.`);

    assert.equal(scoreWriting('   ', { format: WRITING_FORMAT.OTHER }, POINTS).score, 0);
    assert.equal(scoreWriting(tidy, { format: WRITING_FORMAT.ESSAY }, POINTS).score, 0);
  });

  it('does not count a few words as full length where no limit was named', () => {
    assert.equal(scoreWriting('Rural branches matter.', undefined, POINTS).shares.length, 0.06);
  });
});

describe('keyPointsOf', () => {
  it("reads one point a line out of an editor's markup or a sheet's cell", () => {
    assert.deepEqual(keyPointsOf('<p>financial inclusion</p><p></p><p>rural <b>branches</b></p>'), [
      'financial inclusion',
      'rural branches',
    ]);
    assert.deepEqual(keyPointsOf('one\ntwo'), ['one', 'two']);
  });
});
