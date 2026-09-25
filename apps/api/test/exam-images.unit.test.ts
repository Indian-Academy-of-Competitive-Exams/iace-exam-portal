import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { imageUrlsIn } from '../src/attempts/exam-images';
import { FakeStorage } from './support/fakes';

const storage = () => new FakeStorage() as unknown as Parameters<typeof imageUrlsIn>[0];
const KEY = 'questions/images/a1b2.webp';
const html = [`<p>Read it<img data-key="${KEY}"></p>`];

describe('imageUrlsIn — the url a content image is served on', () => {
  /** The failure this prevents: a per-request signature, which caches a copy per student. */
  it('gives one key the same url on every call', () => {
    const store = storage();

    assert.equal(imageUrlsIn(store, html).get(KEY), imageUrlsIn(store, html).get(KEY));
  });

  it('resolves a key one sitting quotes twice exactly once', () => {
    const urls = imageUrlsIn(storage(), [...html, `<img data-key="${KEY}">`]);

    assert.equal(urls.size, 1);
  });

  it('holds nothing for content without an image', () => {
    assert.equal(imageUrlsIn(storage(), ['<p>Just words</p>']).size, 0);
  });
});
