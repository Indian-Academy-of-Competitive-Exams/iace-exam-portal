import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { previewTextOf } from '../src/questions/question-content';

describe('previewTextOf', () => {
  /** The bug: a list cell rendered `<p>Solve <span data-latex=...` at the reader, verbatim. */
  it('gives back the question, not its markup', () => {
    assert.equal(
      previewTextOf('<p><strong>Bold</strong> and <em>italic</em></p>'),
      'Bold and italic',
    );
  });

  /** An author recognises their own LaTeX; they would not recognise an empty span. */
  it('keeps a formula as the LaTeX it was written as', () => {
    const html = '<p>Solve <span data-type="inline-math" data-latex="x^2"></span> for x</p>';

    assert.equal(previewTextOf(html), 'Solve x^2 for x');
  });

  /** A cell cannot show a picture, and an image tag says less than the word does. */
  it('says an image is there rather than printing its tag', () => {
    const html = '<p>Study the figure</p><img data-key="questions/images/a.png">';

    assert.equal(previewTextOf(html), 'Study the figure [image]');
  });

  it('keeps list items apart rather than running them together', () => {
    assert.equal(previewTextOf('<ul><li>One</li><li>Two</li></ul>'), 'One Two');
  });

  /** A comparison is ordinary in a maths question, and `&lt;` is not what was typed. */
  it('reads entities back as the characters they stand for', () => {
    assert.equal(previewTextOf('<p>If a &lt; b and b &gt; c</p>'), 'If a < b and b > c');
  });

  it('leaves plain text exactly as it is', () => {
    assert.equal(previewTextOf('What is 20% of 150?'), 'What is 20% of 150?');
  });

  it('collapses the whitespace tags leave behind', () => {
    assert.equal(previewTextOf('<p>a</p>\n\n<p>b</p>'), 'a b');
  });
});
