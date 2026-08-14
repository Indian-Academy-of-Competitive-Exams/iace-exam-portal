/**
 * Conventional commits, enforced (docs/03 §11) — the style this repo already
 * uses, minus the occasional `chore(scope) - subject` that slips through and
 * then does not group with anything.
 *
 * The rules below are the defaults with two deliberate changes, both because
 * commit messages here carry the reasoning that would otherwise have to live in
 * a comment: bodies wrap at 100 (the same width prettier uses, so a message
 * reads the same in a terminal as the code does), and there is no hard cap on
 * how many lines a body may have.
 */
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'body-max-line-length': [2, 'always', 100],
    'footer-max-line-length': [0],
    // `type(scope): subject`. Kept explicit rather than inherited so adding a
    // type is an edit here and not a debate in review.
    'type-enum': [
      2,
      'always',
      ['feat', 'fix', 'refactor', 'perf', 'docs', 'test', 'build', 'ci', 'chore', 'revert'],
    ],
  },
};
