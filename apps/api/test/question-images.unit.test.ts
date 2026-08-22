import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AppException, QUESTION_IMAGE_MAX_BYTES } from '@iace/contracts';
import { checkQuestionImage, questionImageKey } from '../src/questions/question-images';

const file = (over: Partial<{ size: number; mimetype: string }> = {}) => ({
  size: 1024,
  mimetype: 'image/png',
  ...over,
});

describe('questionImageKey', () => {
  it('files every image under one prefix, whoever uploaded it', () => {
    assert.ok(questionImageKey('image/png').startsWith('questions/images/'));
  });

  /** Two authors both uploading "diagram1.png" must not land on one object. */
  it('never repeats, so an upload cannot overwrite somebody else’s image', () => {
    const keys = new Set(Array.from({ length: 50 }, () => questionImageKey('image/png')));

    assert.equal(keys.size, 50);
  });

  /** From the VERIFIED content type, never a filename: "art.png.exe" is a filename. */
  it('takes the extension from the content type', () => {
    assert.match(questionImageKey('image/png'), /\.png$/);
    assert.match(questionImageKey('image/webp'), /\.webp$/);
    assert.match(questionImageKey('image/gif'), /\.gif$/);
  });
});

describe('checkQuestionImage', () => {
  it('accepts the formats a diagram actually arrives in', () => {
    for (const mimetype of ['image/png', 'image/jpeg', 'image/webp', 'image/gif']) {
      assert.doesNotThrow(() => checkQuestionImage(file({ mimetype })));
    }
  });

  /** An SVG is a script container, and this renders in a candidate's browser mid-test. */
  it('refuses SVG, however much it looks like an image', () => {
    assert.throws(() => checkQuestionImage(file({ mimetype: 'image/svg+xml' })), AppException.is);
  });

  it('refuses a type nobody asked for', () => {
    for (const mimetype of ['application/pdf', 'text/html', 'application/zip']) {
      assert.throws(() => checkQuestionImage(file({ mimetype })), AppException.is);
    }
  });

  it('refuses an image over the limit, and says what to do', () => {
    assert.throws(
      () => checkQuestionImage(file({ size: QUESTION_IMAGE_MAX_BYTES + 1 })),
      (error: unknown) => {
        assert.ok(AppException.is(error));
        assert.match(error.message, /2MB/);
        return true;
      },
    );
  });

  it('accepts one exactly at the limit', () => {
    assert.doesNotThrow(() => checkQuestionImage(file({ size: QUESTION_IMAGE_MAX_BYTES })));
  });

  it('refuses an empty file rather than storing nothing', () => {
    assert.throws(() => checkQuestionImage(file({ size: 0 })), AppException.is);
  });

  it('refuses a request that carried no file at all', () => {
    assert.throws(
      () => checkQuestionImage(undefined),
      (error: unknown) => {
        assert.ok(AppException.is(error));
        assert.ok(error.fieldErrors?.file);
        return true;
      },
    );
  });
});
