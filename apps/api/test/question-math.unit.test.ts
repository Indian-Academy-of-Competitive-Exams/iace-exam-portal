import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { firstMathError, latexIn, mathErrorIn } from '../src/questions/question-math';

describe('latexIn', () => {
  it('finds the formulas the editor wrote', () => {
    const html = '<p>Solve <span data-type="inline-math" data-latex="x^2"></span> and 2</p>';

    assert.deepEqual(latexIn(html), ['x^2']);
  });

  it('finds all of them, in order', () => {
    assert.deepEqual(latexIn('<span data-latex="a"></span><span data-latex="b"></span>'), [
      'a',
      'b',
    ]);
  });

  /** The attribute is html-escaped, so KaTeX would otherwise be handed `&lt;` and refuse it. */
  it('unescapes the attribute before anything tries to parse it', () => {
    assert.deepEqual(latexIn('<span data-latex="a &lt; b"></span>'), ['a < b']);
    assert.deepEqual(latexIn('<span data-latex="a &amp;&amp; b"></span>'), ['a && b']);
  });

  it('finds none in ordinary prose', () => {
    assert.deepEqual(latexIn('<p>What is 20% of 150?</p>'), []);
  });
});

describe('mathErrorIn', () => {
  it('passes a formula that renders', () => {
    for (const latex of ['x^2', '\\frac{a}{b}', '\\sqrt{16}', 'H_2O']) {
      assert.equal(mathErrorIn(latex), null, latex);
    }
  });

  it('catches the half-typed ones', () => {
    for (const latex of ['\\frac{a}', 'x^', '{']) {
      assert.ok(mathErrorIn(latex), latex);
    }
  });

  /** The one the lenient render misses: with throwOnError off this draws rather than flags. */
  it('catches a command that does not exist', () => {
    assert.match(mathErrorIn('\\notacommand{x}') ?? '', /Undefined control sequence/);
  });
});

describe('firstMathError', () => {
  it('says nothing about content that is fine', () => {
    assert.equal(firstMathError('<p>a <span data-latex="x^2"></span></p>'), null);
  });

  it('names the formula that broke, not just that one did', () => {
    const html = '<span data-latex="x^2"></span><span data-latex="\\frac{a}"></span>';
    const failure = firstMathError(html);

    assert.equal(failure?.latex, '\\frac{a}');
    assert.match(failure?.message ?? '', /Unexpected end of input/);
  });
});
