/**
 * The pre-commit gate (docs/03 §11); CI is the backstop, not the first line of defense.
 * Formatting runs PER FILE (prettier). Lint and typecheck cannot: ESLint's flat config and
 * `tsc -p` are project-wide, so both run through turbo across the workspace instead — cached,
 * so untouched packages are a hit and touched ones were being rechecked anyway.
 */
export default {
  '*.{ts,tsx,js,jsx,mjs,cjs,json,css,md,yml,yaml}': ['prettier --write'],

  // Shell is what prettier cannot parse and eslint never sees — the hooks included.
  '*.sh': ['shellcheck'],
  '.husky/{pre-commit,commit-msg}': ['shellcheck'],

  // Prisma's own formatter, for the file prettier does not understand; fixes rather than complains, and lint-staged re-stages the result.
  '*.prisma': () => 'pnpm exec prisma format --schema prisma/schema.prisma',

  '*.{ts,tsx}': () => ['pnpm lint', 'pnpm typecheck'],
};
