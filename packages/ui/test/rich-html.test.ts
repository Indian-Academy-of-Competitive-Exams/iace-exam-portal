import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { richHtml } from '../src/lib/rich-html';

/** What a candidate is shown mid-test, from markup the bank stored and nobody re-read. */
describe('richHtml', () => {
  it('renders a table, its cells and its spans as authored', () => {
    const html = richHtml(
      '<table><thead><tr><th colspan="2">Year</th></tr></thead><tbody><tr><td>2024</td><td>2025</td></tr></tbody></table>',
    );

    assert.match(html, /<table>/);
    assert.match(html, /<th colspan="2">Year<\/th>/);
    assert.match(html, /<td>2024<\/td>/);
  });

  it('gives a table its own scroll box, so the screen around it never scrolls', () => {
    const html = richHtml('<table><tbody><tr><td>a</td></tr></tbody></table>');

    assert.match(html, /<div class="rich-scroll"><table>/);
  });

  it('keeps the marks a question is written with', () => {
    const html = richHtml(
      '<p>H<sub>2</sub>O and x<sup>2</sup>, <strong>bold</strong> <em>italic</em> <u>under</u></p><ul><li>one</li></ul>',
    );

    for (const tag of ['sub', 'sup', 'strong', 'em', 'u', 'ul', 'li']) {
      assert.match(html, new RegExp(`<${tag}>`), `${tag} should survive`);
    }
  });

  it('keeps an image the bank hosts, with its alt text', () => {
    const html = richHtml(
      '<img data-key="questions/images/1.png" src="https://s3.example.com/q/1.png" alt="Figure 1">',
    );

    assert.match(html, /src="https:\/\/s3\.example\.com\/q\/1\.png"/);
    assert.match(html, /alt="Figure 1"/);
  });

  it('drops a script outright, content and all', () => {
    const html = richHtml('<p>Before</p><script>window.stolen = 1;</script><p>After</p>');

    assert.doesNotMatch(html, /script/i);
    assert.doesNotMatch(html, /stolen/);
    assert.match(html, /Before/);
    assert.match(html, /After/);
  });

  it('drops the handler an image would fire, and keeps the image', () => {
    const html = richHtml(
      '<img data-key="k" src="https://s3.example.com/q/1.png" onerror="alert(1)">',
    );

    assert.doesNotMatch(html, /onerror/i);
    assert.match(html, /<img src="https:\/\/s3\.example\.com\/q\/1\.png">/);
  });

  it('removes an image whose source is not fetchable', () => {
    assert.doesNotMatch(richHtml('<img data-key="k" src="javascript:alert(1)">'), /<img/);
  });

  /** A src the server signed always rides with a key; anything else is a pixel tracking the student. */
  it('drops an image that carries no key, wherever it points', () => {
    const html = richHtml('<p>Look</p><img src="https://tracker.example/x.gif">');

    assert.doesNotMatch(html, /<img|tracker/);
    assert.match(html, /Look/);
  });

  it('drops an image whose key is empty', () => {
    assert.doesNotMatch(richHtml('<img data-key="" src="https://tracker.example/x.gif">'), /<img/);
  });

  /** A parser reads `<image>` as `<img>`, which a server-side pattern looking for `<img` misses. */
  it('drops a keyless <image> element a parser rewrites to an img', () => {
    assert.doesNotMatch(richHtml('<image src="https://tracker.example/x.gif">'), /<img/);
  });

  it('keeps a signed image from storage or from local MinIO, without echoing its key', () => {
    for (const src of ['https://s3.example.com/q/1.png', 'http://localhost:9000/iace/q/1.png']) {
      const html = richHtml(`<img data-key="questions/images/1.png" src="${src}">`);

      assert.equal(html, `<img src="${src}">`);
    }
  });

  it('unwraps a tag it does not know, so the words survive the tag', () => {
    const html = richHtml('<div class="wrapper"><a href="https://evil.test">Read this</a></div>');

    assert.doesNotMatch(html, /<a |<div/);
    assert.doesNotMatch(html, /evil\.test/);
    assert.match(html, /Read this/);
  });

  it('renders an inline equation as KaTeX markup, not as an empty span', () => {
    const html = richHtml('<p><span data-type="inline-math" data-latex="\\frac{a}{b}"></span></p>');

    assert.match(html, /class="math-render"/);
    assert.match(html, /katex/);
    assert.doesNotMatch(html, /data-latex/);
  });

  it('renders a display equation in its own block', () => {
    const html = richHtml('<div data-type="block-math" data-latex="x^2"></div>');

    assert.match(html, /math-render--display/);
    assert.match(html, /katex/);
  });

  it('shows an equation that will not parse rather than taking the paper down', () => {
    assert.doesNotThrow(() => richHtml('<span data-latex="\\frac{"></span>'));
    assert.match(richHtml('<span data-latex="\\frac{"></span>'), /math-render/);
  });

  /** A step of emphasis is the one thing a span may carry out of the bank and onto the paper. */
  it('keeps the size step on a span', () => {
    const html = richHtml('<p><span data-size="large">20%</span> of 150</p>');

    assert.match(html, /data-size="large"/);
    assert.match(html, />20%</);
  });

  it('strips anything else a span arrives with', () => {
    const html = richHtml(
      '<p><span class="x" style="font-size:40px" data-size="small">a</span></p>',
    );

    assert.match(html, /data-size="small"/);
    assert.doesNotMatch(html, /style=/);
    assert.doesNotMatch(html, /class="x"/);
  });

  it('reads a formula through its escaping, the way the editor stored it', () => {
    const html = richHtml('<span data-latex="a &lt; b"></span>');

    assert.match(html, /katex/);
    assert.match(html, /class="mrel"/);
  });
});
