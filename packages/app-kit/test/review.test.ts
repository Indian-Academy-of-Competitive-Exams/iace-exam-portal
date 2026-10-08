import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ANSWER_MODE, type AnswerKey } from '@iace/contracts';
import { answerKeyText } from '../src/review';

const keyed = (answers: AnswerKey['answers']) => ({
  answerKey: { mode: ANSWER_MODE.EXACT, answers },
});

describe('answerKeyText', () => {
  it('reads the key in the language the review shows', () => {
    assert.equal(answerKeyText(keyed({ en: 'Delhi', hi: 'दिल्ली' }), ['hi']), 'दिल्ली');
  });

  /** The failure this prevents: a Hindi sitting marked against an English key, shown no key at all. */
  it('falls back to whichever language holds the key, as marking accepts any', () => {
    assert.equal(answerKeyText(keyed({ en: 'Delhi' }), ['hi']), 'Delhi');
    assert.equal(answerKeyText(keyed({ en: '', hi: 'दिल्ली' }), ['en']), 'दिल्ली');
  });

  it('is null for a question with options, and for a key nobody wrote', () => {
    assert.equal(answerKeyText({ answerKey: null }, ['en']), null);
    assert.equal(answerKeyText({}, ['en']), null);
    assert.equal(answerKeyText(keyed({}), ['en']), null);
  });
});
