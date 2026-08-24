import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { asContentHtml, htmlFromPlainText } from '../src/questions/question-content';

describe('htmlFromPlainText', () => {
  /** The bug: a sheet cell was stored raw, and every reader of it treats content as html. */
  it('escapes a cell rather than letting it be read as markup', () => {
    assert.equal(htmlFromPlainText('If a<b and c>d'), '<p>If a&lt;b and c&gt;d</p>');
    assert.equal(htmlFromPlainText('Ram & Shyam'), '<p>Ram &amp; Shyam</p>');
  });

  /** A sheet cannot format, so a tag typed into a cell is shown to the admin, not obeyed. */
  it('shows a tag typed into a cell as the tag', () => {
    assert.equal(htmlFromPlainText('<b>Bold</b>'), '<p>&lt;b&gt;Bold&lt;/b&gt;</p>');
  });

  it('makes a paragraph of every line', () => {
    assert.equal(htmlFromPlainText('One\r\nTwo'), '<p>One</p><p>Two</p>');
  });

  it('has nothing to say about an empty cell', () => {
    assert.equal(htmlFromPlainText('   '), '');
  });
});

describe('asContentHtml', () => {
  it('gives a stored field one root', () => {
    assert.equal(asContentHtml('<p>One</p><p>Two</p>'), '<div><p>One</p><p>Two</p></div>');
  });

  /** Every save re-writes the field, so wrapping had better not nest a little deeper each time. */
  it('leaves a field that already has its root alone', () => {
    assert.equal(asContentHtml('<div><p>One</p></div>'), '<div><p>One</p></div>');
  });
});
