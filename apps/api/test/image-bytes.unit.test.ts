import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { sniffImage } from '../src/questions/image-bytes';
import { gifBytes, jpegBytes, pngBytes, webpBytes } from './support/image-bytes';

describe('sniffImage', () => {
  it('reads a PNG, and its size out of the IHDR chunk', () => {
    assert.deepEqual(sniffImage(pngBytes(800, 600)), {
      contentType: 'image/png',
      width: 800,
      height: 600,
    });
  });

  /** The size is in a frame header past the metadata, so a JPEG has to be walked, not indexed. */
  it('reads a JPEG by walking past its APP0 segment', () => {
    assert.deepEqual(sniffImage(jpegBytes(1024, 768)), {
      contentType: 'image/jpeg',
      width: 1024,
      height: 768,
    });
  });

  it('reads a GIF', () => {
    assert.deepEqual(sniffImage(gifBytes(320, 240)), {
      contentType: 'image/gif',
      width: 320,
      height: 240,
    });
  });

  it('reads all three WebP encodings, which keep their size in three different places', () => {
    for (const chunk of ['VP8 ', 'VP8L', 'VP8X'] as const) {
      assert.deepEqual(
        sniffImage(webpBytes(640, 480, chunk)),
        { contentType: 'image/webp', width: 640, height: 480 },
        chunk,
      );
    }
  });

  /** The whole point: the name said PNG and the bytes say otherwise. */
  it('is null for anything that is not one of the four', () => {
    for (const bytes of [
      Buffer.from('<svg onload="alert(1)"></svg>'),
      Buffer.from('<!doctype html><script>alert(1)</script>'),
      Buffer.from('%PDF-1.7\n%âãÏÓ'),
      Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]),
      Buffer.alloc(0),
    ]) {
      assert.equal(sniffImage(bytes), null, bytes.subarray(0, 8).toString('latin1'));
    }
  });

  /** A PNG signature with nothing behind it is a header, not an image. */
  it('is null when the magic bytes are right but the header is truncated', () => {
    assert.equal(sniffImage(pngBytes(800, 600).subarray(0, 16)), null);
  });

  it('is null for a zero-sized image, however well-formed the header', () => {
    assert.equal(sniffImage(pngBytes(0, 600)), null);
  });
});
