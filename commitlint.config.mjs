/**
 * Conventional commits, enforced (docs/03 §11).
 * Two deliberate changes from the defaults: body wraps at 100 (matches prettier), no cap on how
 * many lines a body may have — commit messages here carry reasoning that would otherwise live in
 * a comment.
 */
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'body-max-line-length': [2, 'always', 100],
    'footer-max-line-length': [0],
    // `type(scope): subject`. Kept explicit so adding a type is an edit here, not a debate in review.
    'type-enum': [
      2,
      'always',
      ['feat', 'fix', 'refactor', 'perf', 'docs', 'test', 'build', 'ci', 'chore', 'revert'],
    ],
  },
};
