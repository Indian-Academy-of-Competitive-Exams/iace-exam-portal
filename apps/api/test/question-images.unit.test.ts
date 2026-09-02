import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AppException, QUESTION_IMAGE_MAX_BYTES, QUESTION_IMAGE_MAX_PIXELS } from '@iace/contracts';
import {
  applyImageUrls,
  checkQuestionImage,
  imageKeysIn,
  questionImageKey,
  stripImageSrc,
  withoutForeignImages,
} from '../src/questions/question-images';
import { gifBytes, jpegBytes, pngBytes, webpBytes } from './support/image-bytes';

const file = (over: Partial<{ size: number; mimetype: string; buffer: Buffer }> = {}) => ({
  size: 1024,
  mimetype: 'image/png',
  buffer: pngBytes(800, 600),
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
    for (const buffer of [
      pngBytes(800, 600),
      jpegBytes(800, 600),
      gifBytes(80, 60),
      webpBytes(80, 60),
    ]) {
      assert.doesNotThrow(() => checkQuestionImage(file({ buffer })));
    }
  });

  /** The name is the uploader's choice; the bytes are not, so the bytes decide. */
  it('reports what the file really is, not what it was called', () => {
    const image = checkQuestionImage(file({ mimetype: 'image/png', buffer: jpegBytes(640, 480) }));

    assert.equal(image.contentType, 'image/jpeg');
  });

  /** An SVG is a script container, and this renders in a candidate's browser mid-test. */
  it('refuses an SVG dressed as a PNG', () => {
    const buffer = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>');

    assert.throws(
      () => checkQuestionImage(file({ mimetype: 'image/png', buffer })),
      AppException.is,
    );
  });

  it('refuses bytes that are not an image at all', () => {
    for (const buffer of [
      Buffer.from('<!doctype html><script>alert(1)</script>'),
      Buffer.from('%PDF-1.7'),
      Buffer.from([0x4d, 0x5a, 0x90, 0x00]),
    ]) {
      assert.throws(() => checkQuestionImage(file({ buffer })), AppException.is);
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

  /** Small on disk, ruinous once drawn: this is what a decompression bomb looks like. */
  it('refuses an image too big to draw, however few bytes it took', () => {
    assert.throws(
      () => checkQuestionImage(file({ size: 40_000, buffer: pngBytes(20_000, 20_000) })),
      (error: unknown) => {
        assert.ok(AppException.is(error));
        assert.match(error.message, /20000×20000/);
        return true;
      },
    );
  });

  it('accepts one exactly at the pixel cap', () => {
    const edge = Math.sqrt(QUESTION_IMAGE_MAX_PIXELS);

    assert.doesNotThrow(() =>
      checkQuestionImage(file({ buffer: pngBytes(Math.floor(edge), Math.floor(edge)) })),
    );
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

describe('withoutForeignImages', () => {
  it('keeps an image of ours and drops one naming a file we do not hold', () => {
    const html =
      '<p><img data-key="questions/images/a.png"><img src="https://evil.test/p.png"></p>';

    assert.equal(withoutForeignImages(html), '<p><img data-key="questions/images/a.png"></p>');
  });
});

describe('the image src, on the way in and out', () => {
  const stored = '<p><img data-key="questions/images/a.png" alt="figure"></p>';

  it('strips the signed src before storing, because it would rot inside the question', () => {
    const authored =
      '<p><img data-key="questions/images/a.png" src="https://s3/x?sig=1" alt="figure"></p>';

    assert.equal(stripImageSrc(authored), stored);
  });

  /** The base64 trap: a `data:` uri would put the image bytes in the question row itself. */
  it('refuses to store a pasted data: uri', () => {
    assert.equal(stripImageSrc('<p><img src="data:image/png;base64,AAAA"></p>'), '<p><img></p>');
  });

  /** `\ssrc=` and not `\s?src=`: the looser one also matches the src inside data-src. */
  it('leaves an attribute that merely ends in src alone', () => {
    const html = '<img data-key="k" data-src="keep" src="drop">';

    assert.equal(stripImageSrc(html), '<img data-key="k" data-src="keep">');
  });

  it('keeps every other attribute, so alt text survives a round trip', () => {
    assert.match(stripImageSrc('<img data-key="k" src="x" alt="a diagram">'), /alt="a diagram"/);
  });

  it('finds the keys a page of content quotes', () => {
    assert.deepEqual(imageKeysIn('<img data-key="a"><p>x</p><img data-key="b">'), ['a', 'b']);
    assert.deepEqual(imageKeysIn('<p>no images here</p>'), []);
  });

  it('puts a fresh src back for the reader, without touching what is stored', () => {
    const urls = new Map([['questions/images/a.png', 'https://s3/fresh']]);

    assert.match(applyImageUrls(stored, urls), /src="https:\/\/s3\/fresh"/);
    assert.match(applyImageUrls(stored, urls), /data-key="questions\/images\/a\.png"/);
  });

  /** A key whose object has gone leaves the tag alone rather than writing `src="undefined"`. */
  it('leaves an image alone when nothing signed its key', () => {
    assert.equal(applyImageUrls(stored, new Map()), stored);
  });

  it('round-trips: what comes back out strips to exactly what went in', () => {
    const urls = new Map([['questions/images/a.png', 'https://s3/fresh']]);

    assert.equal(stripImageSrc(applyImageUrls(stored, urls)), stored);
  });
});
