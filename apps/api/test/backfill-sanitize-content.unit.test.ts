import '../../../packages/ui/test/support/dom';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { imageKeysIn } from '@iace/contracts';
import { richHtml } from '../../../packages/ui/src/lib/rich-html';
import { applyImageUrls } from '../src/questions';
import { sanitizeContentNode } from '../src/questions/question-core';

/** The student pipeline: the server signs the keys it finds and swaps each src, the client joins the nodes and renders. */
const sign = (nodes: string[]): ReadonlyMap<string, string> =>
  new Map(nodes.flatMap(imageKeysIn).map((key) => [key, `https://signed.example/${key}`] as const));

const servedRender = (nodes: string[]): string => {
  const urls = sign(nodes);
  return richHtml(nodes.map((node) => applyImageUrls(node, urls)).join(''));
};

/** A browser's own reading: does any rendered image actually point at the tracker? */
const tracks = (rendered: string): boolean => {
  const doc = new DOMParser().parseFromString(rendered, 'text/html');
  return [...doc.querySelectorAll('img')].some((img) =>
    (img.getAttribute('src') ?? '').includes('tracker.example'),
  );
};

const TRACKER = 'https://tracker.example/x.gif';

const CRAFTED: Readonly<Record<string, string[]>> = {
  'an <image> element a parser rewrites to <img>': [`<p><image data-key="k" src="${TRACKER}"></p>`],
  'a stray <img> whose removal leaves a single-quoted src': [
    `<p><<img>img data-key="k" src='${TRACKER}'></p>`,
  ],
  'a stray <img> with an unquoted src': [`<p><<img>img data-key="k" src=${TRACKER}></p>`],
  'a keyed tag with no space before src': [`<p><<img>img data-key="k"src="${TRACKER}"></p>`],
  'a keyed tag whose alt hides a closing bracket': [
    `<p><<img>img data-key="k" alt=">" src="${TRACKER}"></p>`,
  ],
  'a crafted input inside an option, not the stem': [
    `<p><image data-key="k" src="${TRACKER}"></p>`,
  ],
  'a tag split across two adjacent stored nodes': [
    '<p>a</p><im',
    `g data-key="k" src="${TRACKER}">`,
  ],
};

describe('sanitizeContentNode neutralises crafted legacy image markup', () => {
  for (const [name, raw] of Object.entries(CRAFTED)) {
    it(name, () => {
      assert.equal(tracks(servedRender(raw)), true, 'the raw input must reach a candidate');
      assert.equal(tracks(servedRender(raw.map(sanitizeContentNode))), false);
    });
  }

  it('is idempotent: a second transform of a crafted node changes nothing', () => {
    for (const raw of Object.values(CRAFTED)) {
      const once = raw.map(sanitizeContentNode);
      assert.deepEqual(once.map(sanitizeContentNode), once);
    }
  });
});
