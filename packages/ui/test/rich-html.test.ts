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
    const html = richHtml('<img src="https://s3.example.com/q/1.png" alt="Figure 1">');

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
    const html = richHtml('<img src="https://s3.example.com/q/1.png" onerror="alert(1)">');

    assert.doesNotMatch(html, /onerror/i);
    assert.match(html, /<img src="https:\/\/s3\.example\.com\/q\/1\.png">/);
  });

  it('removes an image whose source is not fetchable', () => {
    assert.doesNotMatch(richHtml('<img src="javascript:alert(1)">'), /<img/);
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

  it('reads a formula through its escaping, the way the editor stored it', () => {
    const html = richHtml('<span data-latex="a &lt; b"></span>');

    assert.match(html, /katex/);
    assert.match(html, /class="mrel"/);
  });
});
