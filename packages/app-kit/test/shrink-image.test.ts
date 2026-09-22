import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { drawnSize, webpName, worthEncoding } from '../browser/shrink-image';

describe('worthEncoding', () => {
  it('re-encodes the screenshots a diagram is pasted from', () => {
    assert.equal(worthEncoding({ type: 'image/png', size: 900 * 1024 }), true);
    assert.equal(worthEncoding({ type: 'image/jpeg', size: 1_500_000 }), true);
  });

  /** The failure this prevents: a crisp 40 KB chart redrawn lossily for nothing. */
  it('leaves a small file alone', () => {
    assert.equal(worthEncoding({ type: 'image/png', size: 40 * 1024 }), false);
  });

  /** A canvas keeps the first frame and drops the rest, which would be a silent edit. */
  it('never touches a GIF', () => {
    assert.equal(worthEncoding({ type: 'image/gif', size: 900 * 1024 }), false);
  });
});

describe('drawnSize', () => {
  it('caps the width and keeps the shape', () => {
    assert.deepEqual(drawnSize(3200, 1800), { width: 1600, height: 900 });
  });

  it('never upscales a diagram narrower than the cap', () => {
    assert.deepEqual(drawnSize(640, 480), { width: 640, height: 480 });
  });
});

describe('webpName', () => {
  it('swaps the extension, whatever the name carries', () => {
    assert.equal(webpName('pie chart v2.final.png'), 'pie chart v2.final.webp');
    assert.equal(webpName('diagram'), 'diagram.webp');
  });
});
